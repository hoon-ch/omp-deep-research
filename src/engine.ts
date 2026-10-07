import { randomUUID } from "node:crypto";
import { CRITIC_INSTRUCTIONS, CRITIC_OUTPUT_SCHEMA, EXPLORE_INSTRUCTIONS, EXPLORE_OUTPUT_SCHEMA, ITERATE_INSTRUCTIONS, ITERATE_OUTPUT_SCHEMA } from "./briefs.ts";
import { baselineRun, bestRun, currentSegment, effectToNoise, metricContract, segmentReports, segmentRuns } from "./runs.ts";
import type { Critic, Evidence, Intake, LedgerEvent, MetricContract, Mission, MissionConfig, MissionSettings, Mode, Pass, Receipt, ResearchState, Run, Segment, SessionEntry, Verdict } from "./types.ts";
import { coversFile, LOCAL_READ_TOOLS, locatorFiles } from "./receipts.ts";
import { canonicalUrl, choice, hash, integer, isRecord, object, positiveNumber, ResearchError, strings, text } from "./validation.ts";

export const ENTRY_TYPE = "io.github.hoon-ch.omp-deep-research.event.v1";
const EVENT_TYPES = ["ledger_reset", "intake_started", "intake_cancelled", "mission_created", "mode_set", "execution_set", "pass_resumed", "pass_paused", "mission_cancelled", "mission_cleared", "tool_counted", "receipt_recorded", "continuation_requested", "evidence_added", "segment_started", "run_logged", "run_flagged", "notes_updated", "usage_recorded", "critic_recorded", "verdict_issued"] as const;
export const DEFAULT_SETTINGS: MissionSettings = {
  constraints: ["Research only; do not implement or modify product code."],
  deliverables: ["A structured verdict with evidence, caveats, and a reproducible report."],
  maxContinuations: 6, maxToolCalls: 60, maxChildren: 8, maxMinutes: 20, allowExec: false, allowHarness: false,
};

export function validateMetric(raw: unknown, name = "metric"): MetricContract {
  const c = object(raw, name);
  const metric = text(c.name, `${name}.name`, 64);
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(metric)) throw new ResearchError(`${name}.name must match the METRIC name syntax`);
  return { name: metric, direction: choice(c.direction, ["lower", "higher"], `${name}.direction`) };
}
export function validateSettings(raw: unknown): MissionSettings {
  const c = object(raw, "settings");
  if (typeof c.allowExec !== "boolean") throw new ResearchError("allowExec must be a boolean");
  if (typeof c.allowHarness !== "boolean") throw new ResearchError("allowHarness must be a boolean");
  return {
    constraints: strings(c.constraints, "constraints"), deliverables: strings(c.deliverables, "deliverables"),
    maxContinuations: integer(c.maxContinuations, "maxContinuations", 0, 8),
    maxToolCalls: integer(c.maxToolCalls, "maxToolCalls", 1, 1000),
    maxChildren: integer(c.maxChildren, "maxChildren", 0, 32),
    maxMinutes: integer(c.maxMinutes, "maxMinutes", 1, 240), allowExec: c.allowExec, allowHarness: c.allowHarness,
    ...(c.maxTokens !== undefined ? { maxTokens: integer(c.maxTokens, "maxTokens", 1000, 1_000_000_000) } : {}),
    ...(c.maxCost !== undefined ? { maxCost: positiveNumber(c.maxCost, "maxCost", 10_000) } : {}),
    ...(c.metric !== undefined ? { metric: validateMetric(c.metric) } : {}),
    ...(c.criticModel ? { criticModel: text(c.criticModel, "criticModel", 200) } : {}),
    ...(c.primaryModel ? { primaryModel: text(c.primaryModel, "primaryModel", 200) } : {}),
  };
}
function assertModeConsent(mode: Mode, settings: MissionSettings): void {
  if (mode === "web" && (settings.allowExec || settings.allowHarness)) throw new ResearchError("--allow-exec and --harness are only supported in data/mixed mode");
}
export function validateConfig(raw: unknown): MissionConfig {
  const c = object(raw, "config");
  const mode = choice(c.mode, ["web", "data", "mixed"], "mode");
  const settings = validateSettings(c);
  assertModeConsent(mode, settings);
  let spec: MissionConfig["spec"];
  if (c.spec !== undefined) {
    const s = object(c.spec, "spec");
    const sha256 = text(s.sha256, "spec.sha256", 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ResearchError("spec.sha256 must be a SHA-256 hex digest");
    spec = { path: text(s.path, "spec.path", 4000), sha256 };
  }
  return { ...settings, objective: text(c.objective, "objective", 6000), mode, ...(spec ? { spec } : {}) };
}
function newPass(config: MissionConfig, at: string): Pass {
  return { id: randomUUID(), startedAt: at, deadlineAt: new Date(Date.parse(at) + config.maxMinutes * 60_000).toISOString(), continuations: 0, toolCalls: [], stopIds: [],
    children: 0, tokens: 0, cost: 0, childTokens: 0, childCost: 0 };
}
export function current(state: ResearchState): Mission {
  if (!state.mission) throw new ResearchError(state.intake
    ? "Intake is pending. Clarify the mission with the user, then call deep_research op='start'."
    : "No mission. Start one with /deep-research --mode web|data|mixed <objective>, /deep-research --spec <file>, or /deep-research <objective> for a clarifying intake.");
  return state.mission;
}
export function active(state: ResearchState): Mission {
  const m = current(state);
  if (m.phase !== "active") throw new ResearchError(`Mission is ${m.phase}; use /deep-research resume or start a new mission.`);
  return m;
}
export function evidenceDigest(m: Mission): string {
  return hash({ evidence: m.evidence, runs: m.runs, segments: m.segments });
}
function apply(state: ResearchState, event: LedgerEvent): void {
  const d = object(event.data, "event.data");
  if (event.type === "intake_started") {
    state.intake = { id: event.missionId, startedAt: event.at, draft: typeof d.draft === "string" ? d.draft : "", settings: validateSettings(d.settings) };
    return;
  }
  if (event.type === "intake_cancelled") {
    if (state.intake?.id !== event.missionId) throw new ResearchError("Research ledger intake ordering is invalid");
    state.intake = undefined;
    return;
  }
  if (event.type === "mission_created") {
    const config = validateConfig(d.config);
    const pass = object(d.pass) as unknown as Pass;
    if (!Array.isArray(pass.toolCalls) || !Number.isFinite(Date.parse(pass.deadlineAt))) throw new ResearchError("Corrupt research pass");
    if (state.intake?.id === event.missionId) state.intake = undefined;
    const segment: Segment = { index: 0, at: event.at, reason: "Mission start", ...(config.metric ? { metric: config.metric } : {}) };
    state.mission = { ...config, id: event.missionId, createdAt: event.at, phase: "active", pass: structuredClone(pass), receipts: [], evidence: [], runs: [], segments: [segment], critics: [], verdicts: [], notes: "" };
    return;
  }
  const m = current(state);
  if (event.missionId !== m.id) throw new ResearchError("Research ledger mission ordering is invalid");
  switch (event.type) {
    case "mission_cleared": state.mission = undefined; break;
    case "mode_set": { const mode = choice(d.mode, ["web", "data", "mixed"], "mode"); assertModeConsent(mode, m); m.mode = mode; break; }
    case "execution_set": {
      const settings = executionSettings(m, d.permission);
      m.allowHarness = settings.allowHarness; m.allowExec = settings.allowExec; break;
    }
    case "pass_resumed": m.phase = "active"; m.pass = structuredClone(d.pass) as Pass; delete m.pauseReason; break;
    case "pass_paused": m.phase = "paused"; m.pauseReason = text(d.reason, "reason"); break;
    case "mission_cancelled": m.phase = "cancelled"; m.pauseReason = text(d.reason, "reason"); break;
    case "tool_counted": {
      m.pass.toolCalls.push(text(d.toolCallId, "toolCallId"));
      if (d.children !== undefined) m.pass.children += integer(d.children, "children", 0, 1000);
      break;
    }
    case "receipt_recorded": m.receipts.push(structuredClone(d.receipt) as Receipt); break;
    case "continuation_requested": m.pass.continuations++; m.pass.stopIds.push(text(d.stopId, "stopId")); break;
    case "evidence_added": m.evidence.push(structuredClone(d.evidence) as Evidence); break;
    case "segment_started": {
      const s = structuredClone(d.segment) as Segment;
      if (s.index !== m.segments.length) throw new ResearchError("Research ledger segment ordering is invalid");
      m.segments.push(s); break;
    }
    case "run_logged": m.runs.push(structuredClone(d.run) as Run); break;
    case "run_flagged": {
      const r = m.runs.find(r => r.id === d.runId);
      if (!r) throw new ResearchError("Flag refers to an unknown run");
      r.flagReason = text(d.reason, "reason"); break;
    }
    case "notes_updated": m.notes = typeof d.notes === "string" ? d.notes : ""; break;
    case "usage_recorded": {
      const tokens = integer(d.tokens, "tokens", 0, Number.MAX_SAFE_INTEGER); const cost = positiveNumber(d.cost, "cost", Number.MAX_VALUE, true);
      m.pass.tokens += tokens; m.pass.cost += cost;
      if (d.source === "children") { m.pass.childTokens += tokens; m.pass.childCost += cost; }
      break;
    }
    case "critic_recorded": m.critics.push(structuredClone(d.critic) as Critic); break;
    case "verdict_issued": {
      const v = structuredClone(d.verdict) as Verdict;
      m.verdicts.push(v); m.phase = v.disposition === "conclusive" ? "completed" : "paused";
      if (m.phase === "paused") m.pauseReason = "An inconclusive verdict was saved; resume explicitly for follow-up.";
      break;
    }
  }
}
function isResearchEntry(entry: SessionEntry): boolean {
  return entry.type === "custom" && entry.customType === ENTRY_TYPE;
}
/** Research events on the active branch, starting after the operator's last `ledger_reset`. */
export function researchEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  const own = entries.filter(isResearchEntry);
  let reset = -1;
  own.forEach((e, i) => { if (isRecord(e.data) && e.data.type === "ledger_reset") reset = i; });
  return own.slice(reset + 1);
}
export function restore(entries: readonly SessionEntry[]): ResearchState {
  const state: ResearchState = { events: [] };
  const ids = new Set<string>();
  for (const entry of researchEntries(entries)) {
    const raw = object(entry.data, "research event");
    if (raw.schemaVersion !== 1) throw new ResearchError("Unsupported research ledger version; update the extension or run /deep-research reset-ledger");
    const e = raw as unknown as LedgerEvent;
    text(e.id, "event.id"); text(e.missionId, "event.missionId"); choice(e.type, EVENT_TYPES, "event.type");
    if (!Number.isFinite(Date.parse(e.at))) throw new ResearchError("Corrupt research event timestamp");
    if (ids.has(e.id)) continue;
    ids.add(e.id); apply(state, e); state.events.push(structuredClone(e));
  }
  return state;
}
export function makeEvent(missionId: string, type: LedgerEvent["type"], data: unknown, at = new Date().toISOString(), requestId?: string, requestHash?: string): LedgerEvent {
  return { schemaVersion: 1, id: randomUUID(), missionId, at, type, data, ...(requestId ? { requestId, requestHash } : {}) };
}
/** Operator escape hatch for an unreadable ledger: later replay ignores every earlier research event (history is kept). */
export function resetEvent(reason: string, at = new Date().toISOString()): LedgerEvent {
  return makeEvent(randomUUID(), "ledger_reset", { reason }, at);
}
function assertNoOpenWork(state: ResearchState): void {
  if (state.intake) throw new ResearchError("An intake is pending. Finish it in the conversation or use /deep-research cancel.");
  if (state.mission && ["active", "paused"].includes(state.mission.phase)) throw new ResearchError("An open mission exists. Resume it or use /deep-research clear before starting another.");
}
export function startEvent(state: ResearchState, config: MissionConfig, at = new Date().toISOString()): LedgerEvent {
  assertNoOpenWork(state);
  const validated = validateConfig(config);
  return makeEvent(randomUUID(), "mission_created", { config: validated, pass: newPass(validated, at) }, at);
}
/** Cold intake: no mission exists until the agent clarifies objective, mode, constraints and deliverables. */
export function intakeEvent(state: ResearchState, draft: string, settings: MissionSettings, at = new Date().toISOString()): LedgerEvent {
  assertNoOpenWork(state);
  return makeEvent(randomUUID(), "intake_started", { draft, settings: validateSettings(settings) }, at);
}
/** Operator-only mode change for an open mission (Gajae `mode_set`). Recorded evidence stays; the new mode gates what comes next. */
export function modeEvent(state: ResearchState, mode: Mode, at = new Date().toISOString()): LedgerEvent {
  const m = current(state);
  if (m.phase !== "active" && m.phase !== "paused") throw new ResearchError(`Mission is ${m.phase}; only an open mission can change mode`);
  if (m.mode === mode) throw new ResearchError(`Mission is already in ${mode} mode`);
  assertModeConsent(mode, m);
  return makeEvent(m.id, "mode_set", { mode, previousMode: m.mode }, at);
}
/** Permission profiles replace rather than accumulate; choosing harness also revokes unrestricted exec. */
function executionSettings(m: Mission, raw: unknown): { allowHarness: boolean; allowExec: boolean } {
  if (m.phase !== "active" && m.phase !== "paused") throw new ResearchError(`Mission is ${m.phase}; only an open mission can change execution permission`);
  const permission = choice(raw, ["harness", "exec", "deny"], "permission");
  if (permission !== "deny" && m.mode === "web") throw new ResearchError("Execution permission is only supported in data/mixed mode; use /deep-research mode data|mixed first");
  return { allowHarness: permission === "harness", allowExec: permission === "exec" };
}
/** Operator-only consent, independent of pass lifecycle and budgets. */
export function executionEvent(state: ResearchState, permission: "harness" | "exec" | "deny", at = new Date().toISOString()): LedgerEvent {
  const m = current(state);
  executionSettings(m, permission);
  return makeEvent(m.id, "execution_set", { permission, previous: { allowHarness: m.allowHarness, allowExec: m.allowExec } }, at);
}
export function lifecycleEvent(state: ResearchState, op: "resume" | "pause" | "cancel" | "clear", at = new Date().toISOString(), reason?: string): LedgerEvent {
  if (state.intake) {
    if (op === "pause" || op === "resume") throw new ResearchError("An intake is pending; there is no mission pass to pause or resume. Use cancel to abandon it.");
    return makeEvent(state.intake.id, "intake_cancelled", { reason: reason ?? `User requested ${op}` }, at);
  }
  const m = current(state);
  if (op === "resume") {
    if (m.phase !== "paused") throw new ResearchError("Only a paused/inconclusive mission can resume; completed/cancelled missions need a new mission.");
    return makeEvent(m.id, "pass_resumed", { pass: newPass(m, at) }, at);
  }
  if (op === "pause" && m.phase !== "active") throw new ResearchError("Only an active mission can pause");
  if (op === "cancel" && m.phase === "completed") throw new ResearchError("A completed mission cannot be cancelled; use clear to retire it");
  return makeEvent(m.id, op === "clear" ? "mission_cleared" : op === "cancel" ? "mission_cancelled" : "pass_paused", { reason: reason ?? `User requested ${op}` }, at);
}
export function budgetReason(m: Mission, now = Date.now()): string | undefined {
  if (now >= Date.parse(m.pass.deadlineAt)) return "Mission pass wall-clock budget exhausted";
  if (m.pass.toolCalls.length >= m.maxToolCalls) return "Mission pass acquisition-tool budget exhausted";
  return spendReason(m, now);
}
/** Time and usage limits that also bind subagents; `pendingTokens/Cost` is subagent usage not yet persisted by the parent. */
export function spendReason(m: Mission, now = Date.now(), pendingTokens = 0, pendingCost = 0): string | undefined {
  if (now >= Date.parse(m.pass.deadlineAt)) return "Mission pass wall-clock budget exhausted";
  const tokens = m.pass.tokens + pendingTokens; const cost = m.pass.cost + pendingCost;
  if (m.maxTokens !== undefined && tokens >= m.maxTokens) return `Mission pass token budget exhausted (${tokens}/${m.maxTokens})`;
  if (m.maxCost !== undefined && cost >= m.maxCost) return `Mission pass cost budget exhausted ($${cost.toFixed(4)}/$${m.maxCost})`;
  return undefined;
}
export function summary(state: ResearchState): unknown {
  const m = state.mission;
  const intake = state.intake ? { intake: state.intake } : {};
  if (!m) return { mission: null, ...intake };
  return { id: m.id, objective: m.objective, mode: m.mode, phase: m.phase, pauseReason: m.pauseReason, spec: m.spec,
    constraints: m.constraints, deliverables: m.deliverables, allowExec: m.allowExec, allowHarness: m.allowHarness, criticModel: m.criticModel,
    pass: { ...m.pass, toolCalls: m.pass.toolCalls.length },
    limits: { continuations: m.maxContinuations, toolCalls: m.maxToolCalls, children: m.maxChildren, minutes: m.maxMinutes, tokens: m.maxTokens ?? null, cost: m.maxCost ?? null },
    counts: { receipts: m.receipts.length, evidence: m.evidence.length, runs: m.runs.length, segments: m.segments.length },
    segment: { index: currentSegment(m).index, metric: metricContract(m) ?? null, baselineRunId: baselineRun(m)?.id ?? null,
      bestRunId: bestRun(m)?.id ?? null, effectToNoise: effectToNoise(m) },
    evidenceDigest: evidenceDigest(m), notes: m.notes, verdict: m.verdicts.at(-1),
    evidence: m.evidence.map(({ id, title, stance, locator }) => ({ id, title, stance, locator })), ...intake };
}
function receipt(m: Mission, id: unknown, name = "receiptId"): Receipt {
  const r = m.receipts.find(r => r.id === text(id, name, 200));
  if (!r) throw new ResearchError("Unknown source receipt. Use deep_research {op:'read',view:'receipts'} after reading the actual source.");
  return r;
}
function references(m: Mission, value: unknown, name: string, required = true): string[] {
  const ids = [...new Set(strings(value, name))];
  if (required && ids.length === 0) throw new ResearchError(`${name} must cite at least one evidence ID`);
  for (const id of ids) if (!m.evidence.some(e => e.id === id)) throw new ResearchError(`Unknown evidence ID: ${id}`);
  return ids;
}
export interface Prepared { event?: LedgerEvent; result: unknown; }
/** Completes a cold intake. Operator settings (budgets, execution consent, critic, declared metric) are never model-controlled. */
function startMission(intake: Intake | undefined, raw: unknown, requestId: string, requestHash: string, at: string): Prepared {
  if (!intake) throw new ResearchError("No pending intake. Only the user can begin one with /deep-research <objective>.");
  const p = object(raw, "mission");
  const metric = p.metric === undefined ? undefined : validateMetric(p.metric, "mission.metric");
  if (metric && intake.settings.metric && hash(metric) !== hash(intake.settings.metric))
    throw new ResearchError(`The operator declared metric ${intake.settings.metric.name} (${intake.settings.metric.direction}); the intake cannot change it`);
  const config = validateConfig({ ...intake.settings, objective: p.objective, mode: p.mode,
    ...(intake.settings.metric ?? metric ? { metric: intake.settings.metric ?? metric } : {}),
    constraints: [...new Set([...intake.settings.constraints, ...strings(p.constraints, "mission.constraints")])],
    deliverables: [...new Set([...intake.settings.deliverables, ...strings(p.deliverables, "mission.deliverables")])] });
  const data = { config, pass: newPass(config, at) };
  return { event: makeEvent(intake.id, "mission_created", data, at, requestId, requestHash), result: { missionId: intake.id, ...data } };
}
function readView(state: ResearchState, input: Record<string, unknown>): unknown {
  const view = input.view === undefined ? "summary" : choice(input.view, ["summary", "full", "receipts", "runs", "explore", "critic", "iterate"], "view");
  if (view === "summary") return summary(state);
  if (view === "full") return state.mission ?? null;
  const m = current(state);
  if (view === "receipts") {
    const receipts = [...m.receipts].reverse();
    const offset = input.offset === undefined ? 0 : integer(input.offset, "offset", 0, 10000);
    const limit = input.limit === undefined ? 12 : integer(input.limit, "limit", 1, 100);
    return { total: receipts.length, offset, receipts: receipts.slice(offset, offset + limit), nextOffset: offset + limit < receipts.length ? offset + limit : null };
  }
  if (view === "runs") return { segments: segmentReports(m) };
  const mission = { objective: m.objective, mode: m.mode, constraints: m.constraints, deliverables: m.deliverables };
  if (view === "explore") return { instructions: EXPLORE_INSTRUCTIONS, outputSchema: EXPLORE_OUTPUT_SCHEMA,
    childrenLeft: Math.max(0, m.maxChildren - m.pass.children),
    snapshot: { ...mission, knownLocators: [...new Set(m.evidence.map(e => e.locator))], notes: m.notes } };
  if (view === "critic") return { instructions: CRITIC_INSTRUCTIONS, outputSchema: CRITIC_OUTPUT_SCHEMA, criticModel: m.criticModel ?? null, evidenceDigest: evidenceDigest(m),
    evidenceIds: m.evidence.map(e => e.id), snapshot: { ...mission, evidence: m.evidence, segments: segmentReports(m), notes: m.notes } };
  const report = segmentReports(m).at(-1)!;
  return { instructions: ITERATE_INSTRUCTIONS, outputSchema: ITERATE_OUTPUT_SCHEMA, snapshot: { ...mission, segment: report.segment.index, metric: report.metric ?? null,
    baselineRunId: report.baselineId, bestRunId: report.bestId, effectToNoise: report.effectToNoise, counts: report.counts,
    recentRuns: report.runs.slice(-10), flaggedRuns: report.runs.filter(r => r.flagReason).map(r => ({ id: r.id, reason: r.flagReason })),
    harness: { file: "./autoresearch.sh", run: "bash autoresearch.sh", allowed: m.allowHarness || m.allowExec,
      contract: "exit non-zero on failure; print METRIC <name>=<number> lines (primary + secondary); optional ASI <key>=<value> learning lines; deterministic workload, fixed seeds, no live network" },
    notes: m.notes } };
}
/** Pure operation preparation; the adapter persists the event before reporting success. */
export function prepareOperation(state: ResearchState, raw: unknown, toolCallId: string, evaluator: string, cwd: string, at = new Date().toISOString()): Prepared {
  const input = object(raw);
  const op = choice(input.op, ["read", "start", "evidence", "segment", "run", "flag_run", "notes", "critic", "verdict", "export"], "op");
  if (op === "read") return { result: readView(state, input) };
  if (op === "export") return { result: current(state) };
  const requestId = input.requestId === undefined ? toolCallId : text(input.requestId, "requestId", 200);
  const requestHash = hash(input);
  const scope = state.intake?.id ?? state.mission?.id;
  const previous = scope === undefined ? undefined : state.events.find(e => e.missionId === scope && e.requestId === requestId);
  if (previous) {
    if (previous.requestHash !== requestHash) throw new ResearchError("requestId was already used with different input");
    return { result: { duplicate: true, ...object(previous.data) } };
  }
  if (op === "start") return startMission(state.intake, input.mission, requestId, requestHash, at);
  const m = active(state);
  const emit = (type: LedgerEvent["type"], data: object): Prepared => ({ event: makeEvent(m.id, type, data, at, requestId, requestHash), result: data });
  switch (op) {
    case "evidence": {
      const e = object(input.evidence, "evidence");
      const source = choice(e.source, ["web", "file", "experiment"], "evidence.source");
      if ((m.mode === "web" && source !== "web") || (m.mode === "data" && source === "web")) throw new ResearchError(`Evidence source ${source} is not allowed in ${m.mode} mode`);
      const r = receipt(m, e.receiptId);
      if (r.isError && source !== "experiment") throw new ResearchError("A failed fetch/read is not evidence of source contents");
      const locator = source === "web" ? canonicalUrl(text(e.locator, "locator", 4000)) : text(e.locator, "locator", 4000);
      if (source === "web") {
        if (r.tool !== "read") throw new ResearchError("Open the original web source with read before recording evidence; search snippets, github results and task summaries are leads only");
        const observed = r.sourceRefs.some(ref => { try { return canonicalUrl(ref) === locator; } catch { return false; } });
        if (!observed) throw new ResearchError("Web locator was not observed in this receipt; read that exact URL first");
      } else if (source === "file") {
        // Scout reports (`read agent://…`) and task summaries are leads; file evidence needs the file itself.
        if (!Object.hasOwn(LOCAL_READ_TOOLS, r.tool) || !r.paths?.length)
          throw new ResearchError("File evidence needs a receipt from read/grep/find/glob/ast_grep of a local path. Scout reports (agent://…) and task summaries are leads: read the cited file yourself first");
        const files = locatorFiles(locator, cwd);
        if (!files.length) throw new ResearchError("File evidence locator must name the file(s) it cites, e.g. src/a.ts:10-20; docs/b.md:4");
        const unread = files.filter(f => !r.paths!.some(p => coversFile(p, f)));
        if (unread.length) throw new ResearchError(`Receipt ${r.id} did not read ${unread.join(", ")}; read the cited file(s) and use that receipt`);
      } else if (r.tool === "task" || (Object.hasOwn(LOCAL_READ_TOOLS, r.tool) ? !r.paths?.length : r.tool !== "bash" && r.tool !== "eval")) {
        throw new ResearchError("Experiment evidence needs the run's own output (bash/eval) or a local result file read; scout reports and task summaries are leads");
      }
      const claim = text(e.claim, "claim"); const stance = choice(e.stance, ["supports", "contradicts", "context"], "stance");
      const fingerprint = hash({ source, locator, claim: claim.replace(/\s+/g, " ").toLowerCase(), stance });
      const existing = m.evidence.find(v => v.fingerprint === fingerprint);
      if (existing) return { result: { duplicate: true, evidence: existing } };
      const evidence: Evidence = { source, locator, claim, stance, fingerprint, id: `E${m.evidence.length + 1}`, at,
        title: text(e.title, "title", 400), summary: text(e.summary, "summary"), receiptId: r.id };
      return emit("evidence_added", { evidence });
    }
    case "segment": {
      if (m.mode === "web") throw new ResearchError("Experiment segments require data or mixed mode");
      const p = object(input.segment, "segment");
      const segment: Segment = { index: m.segments.length, at, reason: text(p.reason, "segment.reason", 2000),
        ...(p.metric !== undefined ? { metric: validateMetric(p.metric, "segment.metric") } : {}) };
      return emit("segment_started", { segment });
    }
    case "run": {
      if (m.mode === "web") throw new ResearchError("Experiment runs require data or mixed mode");
      const p = object(input.run, "run"); const r = receipt(m, p.receiptId);
      const contract = metricContract(m);
      const primaryMetric = p.primaryMetric === undefined && contract ? contract.name : text(p.primaryMetric, "primaryMetric", 64);
      const direction = p.direction === undefined && contract ? contract.direction : choice(p.direction, ["lower", "higher"], "direction");
      if (contract && (contract.name !== primaryMetric || contract.direction !== direction))
        throw new ResearchError(`Segment ${currentSegment(m).index} measures ${contract.name} (${contract.direction} is better); start a new segment to change the metric or direction`);
      if (p.checksPassed !== undefined && typeof p.checksPassed !== "boolean") throw new ResearchError("checksPassed must be boolean");
      if (segmentRuns(m).some(run => run.receiptId === r.id)) throw new ResearchError("This receipt is already logged as a run in the current segment");
      const value = r.metrics[primaryMetric]; const best = bestRun(m);
      let outcome: Run["outcome"];
      if (r.isError) outcome = "crash";
      else if (p.checksPassed === false || r.metricError || !Number.isFinite(value)) outcome = "checks_failed";
      else if (!best) outcome = "baseline";
      else outcome = (direction === "lower" ? value! < best.metrics[primaryMetric]! : value! > best.metrics[primaryMetric]!) ? "keep" : "discard";
      const run: Run = { id: `R${m.runs.length + 1}`, at, segment: currentSegment(m).index, label: text(p.label, "label", 400),
        hypothesis: text(p.hypothesis, "hypothesis"), receiptId: r.id, primaryMetric, direction, metrics: r.metrics, asi: r.asi, outcome,
        ...(typeof p.checksPassed === "boolean" ? { checksPassed: p.checksPassed } : {}), ...(p.notes ? { notes: text(p.notes, "notes") } : {}) };
      return emit("run_logged", { run });
    }
    case "flag_run": {
      const runId = text(input.runId, "runId", 100);
      if (!m.runs.some(r => r.id === runId)) throw new ResearchError("Unknown run ID");
      return emit("run_flagged", { runId, reason: text(input.reason, "reason") });
    }
    case "notes": return emit("notes_updated", { notes: text(input.notes, "notes", 16_000) });
    case "critic": {
      const p = object(input.critic, "critic"); const r = receipt(m, p.receiptId);
      if (r.isError) throw new ResearchError("A failed tool result cannot substantiate a critic receipt");
      const reviewer = text(p.evaluator, "evaluator", 200);
      if (reviewer === m.primaryModel || reviewer === evaluator) throw new ResearchError("A critic must declare an evaluator distinct from the research model");
      if (m.criticModel && reviewer !== m.criticModel) throw new ResearchError(`Expected configured critic: ${m.criticModel}`);
      // Attestation: the host-observed task input pinned this model. Required when the operator configured a critic.
      let spawnReceiptId: string | undefined;
      if (p.spawnReceiptId !== undefined || m.criticModel) {
        const spawn = receipt(m, p.spawnReceiptId, "spawnReceiptId");
        if (spawn.tool !== "task" || spawn.isError) throw new ResearchError("spawnReceiptId must reference the successful task call that ran the critic");
        if (!spawn.models?.includes(reviewer)) throw new ResearchError(`The referenced task call did not pin ${reviewer}; set model on the scout task item`);
        // The response must be the task result itself (blocking spawn) or a read of one of the agents that call spawned.
        const linked = r.id === spawn.id || (r.tool === "read" && r.sourceRefs.some(ref => spawn.agentIds?.some(id => ref === `agent://${id}` || ref.startsWith(`agent://${id}/`))));
        if (!linked) throw new ResearchError("The critic response receipt must be the spawning task result or a read of agent://<id> for an agent that task spawned");
        spawnReceiptId = spawn.id;
      }
      const critic: Critic = { id: `C${m.critics.length + 1}`, at, evaluator: reviewer, receiptId: r.id, ...(spawnReceiptId ? { spawnReceiptId } : {}),
        evidenceIds: references(m, p.evidenceIds, "critic.evidenceIds"), assessment: choice(p.assessment, ["pass", "revise"], "assessment"),
        summary: text(p.summary, "critic.summary"), concerns: strings(p.concerns, "critic.concerns"), evidenceDigest: evidenceDigest(m) };
      if (critic.evidenceIds.length !== m.evidence.length) throw new ResearchError("The critic must review the complete current evidence set");
      return emit("critic_recorded", { critic });
    }
    case "verdict": {
      const p = object(input.verdict, "verdict");
      const disposition = choice(p.disposition, ["conclusive", "inconclusive"], "disposition");
      if (!Array.isArray(p.findings) || p.findings.length > 100) throw new ResearchError("findings must be an array with at most 100 items");
      const findings = p.findings.map((v, i) => { const f = object(v, `finding[${i}]`); return { claim: text(f.claim, "finding.claim"), evidenceIds: references(m, f.evidenceIds, "finding.evidenceIds") }; });
      const caveats = strings(p.caveats, "caveats"); const digest = evidenceDigest(m); const critic = m.critics.at(-1);
      if (disposition === "conclusive") {
        if (!m.evidence.length || !findings.length) throw new ResearchError("A conclusive verdict needs recorded evidence and cited findings");
        // Contradicting evidence must be confronted: cited by a finding or named (by ID) in a caveat.
        const cited = new Set(findings.flatMap(f => f.evidenceIds)); const caveatText = caveats.join("\n");
        const ignored = m.evidence.filter(e => e.stance === "contradicts" && !cited.has(e.id) && !new RegExp(`\\b${e.id}\\b`).test(caveatText)).map(e => e.id);
        if (ignored.length) throw new ResearchError(`Contradicting evidence ${ignored.join(", ")} must be cited by a finding or addressed by ID in a caveat`);
        if (m.criticModel && !critic) throw new ResearchError("A configured critic receipt is required before a conclusive verdict");
        if (critic && (critic.assessment !== "pass" || critic.evidenceDigest !== digest)) throw new ResearchError("The critic must pass the CURRENT evidence/run snapshot; re-review after changes");
      } else if (!caveats.length) throw new ResearchError("An inconclusive verdict must explain its limitations in caveats");
      const verdict: Verdict = { id: `V${m.verdicts.length + 1}`, at, evaluator, disposition,
        confidence: choice(p.confidence, ["low", "medium", "high"], "confidence"), summary: text(p.summary, "summary"), findings, caveats,
        evidenceDigest: digest, ...(critic && critic.evidenceDigest === digest ? { criticId: critic.id } : {}) };
      return emit("verdict_issued", { verdict });
    }
  }
}
