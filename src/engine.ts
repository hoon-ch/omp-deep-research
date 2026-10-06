import { randomUUID } from "node:crypto";
import type { Critic, Evidence, LedgerEvent, Mission, MissionConfig, Pass, Receipt, ResearchState, Run, SessionEntry, Verdict } from "./types.ts";
import { canonicalUrl, choice, hash, integer, object, ResearchError, strings, text } from "./validation.ts";

export const ENTRY_TYPE = "io.github.hoon-ch.omp-deep-research.event.v1";
const EVENT_TYPES = ["mission_created", "pass_resumed", "pass_paused", "mission_cancelled", "mission_cleared", "tool_counted", "receipt_recorded", "continuation_requested", "evidence_added", "run_logged", "run_flagged", "notes_updated", "critic_recorded", "verdict_issued"] as const;
export const DEFAULT_CONFIG: Omit<MissionConfig, "objective"> = {
  mode: "web", constraints: ["Research only; do not implement or modify product code."],
  deliverables: ["A structured verdict with evidence, caveats, and a reproducible report."],
  maxContinuations: 6, maxToolCalls: 60, maxMinutes: 20, allowExec: false,
};

export function validateConfig(raw: unknown): MissionConfig {
  const c = object(raw, "config");
  if (typeof c.allowExec !== "boolean") throw new ResearchError("allowExec must be a boolean");
  if (c.allowExec && c.mode === "web") throw new ResearchError("--allow-exec is only supported in data/mixed mode");
  return {
    objective: text(c.objective, "objective", 6000), mode: choice(c.mode, ["web", "data", "mixed"], "mode"),
    constraints: strings(c.constraints, "constraints"), deliverables: strings(c.deliverables, "deliverables"),
    maxContinuations: integer(c.maxContinuations, "maxContinuations", 0, 8),
    maxToolCalls: integer(c.maxToolCalls, "maxToolCalls", 1, 1000),
    maxMinutes: integer(c.maxMinutes, "maxMinutes", 1, 240), allowExec: c.allowExec,
    ...(c.criticModel ? { criticModel: text(c.criticModel, "criticModel", 200) } : {}),
    ...(c.primaryModel ? { primaryModel: text(c.primaryModel, "primaryModel", 200) } : {}),
  };
}
function newPass(config: MissionConfig, at: string): Pass {
  return { id: randomUUID(), startedAt: at, deadlineAt: new Date(Date.parse(at) + config.maxMinutes * 60_000).toISOString(), continuations: 0, toolCalls: [], stopIds: [] };
}
export function current(state: ResearchState): Mission {
  if (!state.mission) throw new ResearchError("No mission. Start one with /deep-research --mode web <objective>.");
  return state.mission;
}
export function active(state: ResearchState): Mission {
  const m = current(state);
  if (m.phase !== "active") throw new ResearchError(`Mission is ${m.phase}; use /deep-research resume or start a new mission.`);
  return m;
}
export function evidenceDigest(m: Mission): string {
  return hash({ evidence: m.evidence, runs: m.runs });
}
export function bestRun(m: Mission): Run | undefined {
  const runs = m.runs.filter(r => !r.flagReason && !["crash", "checks_failed"].includes(r.outcome) && Number.isFinite(r.metrics[r.primaryMetric]));
  return runs.reduce<Run | undefined>((best, r) => {
    if (!best) return r;
    const a = r.metrics[r.primaryMetric]!; const b = best.metrics[best.primaryMetric]!;
    return (r.direction === "lower" ? a < b : a > b) ? r : best;
  }, undefined);
}
function apply(state: ResearchState, event: LedgerEvent): void {
  const d = object(event.data, "event.data");
  if (event.type === "mission_created") {
    const config = validateConfig(d.config);
    const pass = object(d.pass) as unknown as Pass;
    if (!Array.isArray(pass.toolCalls) || !Number.isFinite(Date.parse(pass.deadlineAt))) throw new ResearchError("Corrupt research pass");
    state.mission = { ...config, id: event.missionId, createdAt: event.at, phase: "active", pass: structuredClone(pass), receipts: [], evidence: [], runs: [], critics: [], verdicts: [], notes: "" };
    return;
  }
  const m = current(state);
  if (event.missionId !== m.id) throw new ResearchError("Research ledger mission ordering is invalid");
  switch (event.type) {
    case "mission_cleared": state.mission = undefined; break;
    case "pass_resumed": m.phase = "active"; m.pass = structuredClone(d.pass) as Pass; delete m.pauseReason; break;
    case "pass_paused": m.phase = "paused"; m.pauseReason = text(d.reason, "reason"); break;
    case "mission_cancelled": m.phase = "cancelled"; m.pauseReason = text(d.reason, "reason"); break;
    case "tool_counted": m.pass.toolCalls.push(text(d.toolCallId, "toolCallId")); break;
    case "receipt_recorded": m.receipts.push(structuredClone(d.receipt) as Receipt); break;
    case "continuation_requested": m.pass.continuations++; m.pass.stopIds.push(text(d.stopId, "stopId")); break;
    case "evidence_added": m.evidence.push(structuredClone(d.evidence) as Evidence); break;
    case "run_logged": m.runs.push(structuredClone(d.run) as Run); break;
    case "run_flagged": {
      const r = m.runs.find(r => r.id === d.runId);
      if (!r) throw new ResearchError("Flag refers to an unknown run");
      r.flagReason = text(d.reason, "reason"); break;
    }
    case "notes_updated": m.notes = typeof d.notes === "string" ? d.notes : ""; break;
    case "critic_recorded": m.critics.push(structuredClone(d.critic) as Critic); break;
    case "verdict_issued": {
      const v = structuredClone(d.verdict) as Verdict;
      m.verdicts.push(v); m.phase = v.disposition === "conclusive" ? "completed" : "paused";
      if (m.phase === "paused") m.pauseReason = "An inconclusive verdict was saved; resume explicitly for follow-up.";
      break;
    }
  }
}
export function restore(entries: readonly SessionEntry[]): ResearchState {
  const state: ResearchState = { events: [] };
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    const raw = object(entry.data, "research event");
    if (raw.schemaVersion !== 1) throw new ResearchError("Unsupported research ledger version; update the extension before continuing");
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
export function startEvent(state: ResearchState, config: MissionConfig, at = new Date().toISOString()): LedgerEvent {
  if (state.mission && ["active", "paused"].includes(state.mission.phase)) throw new ResearchError("An open mission exists. Resume it or use /deep-research clear before starting another.");
  const validated = validateConfig(config);
  return makeEvent(randomUUID(), "mission_created", { config: validated, pass: newPass(validated, at) }, at);
}
export function lifecycleEvent(state: ResearchState, op: "resume" | "pause" | "cancel" | "clear", at = new Date().toISOString(), reason?: string): LedgerEvent {
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
  return undefined;
}
export function summary(state: ResearchState): unknown {
  const m = state.mission;
  if (!m) return { mission: null };
  return { id: m.id, objective: m.objective, mode: m.mode, phase: m.phase, pauseReason: m.pauseReason,
    constraints: m.constraints, deliverables: m.deliverables, allowExec: m.allowExec, criticModel: m.criticModel,
    pass: { ...m.pass, toolCalls: m.pass.toolCalls.length },
    limits: { continuations: m.maxContinuations, toolCalls: m.maxToolCalls },
    counts: { receipts: m.receipts.length, evidence: m.evidence.length, runs: m.runs.length },
    evidenceDigest: evidenceDigest(m), bestRun: bestRun(m), notes: m.notes,
    verdict: m.verdicts.at(-1), evidence: m.evidence.map(({ id, title, stance, locator }) => ({ id, title, stance, locator })) };
}
function receipt(m: Mission, id: unknown): Receipt {
  const r = m.receipts.find(r => r.id === text(id, "receiptId", 200));
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
/** Pure operation preparation; the adapter persists the event before reporting success. */
export function prepareOperation(state: ResearchState, raw: unknown, toolCallId: string, evaluator: string, at = new Date().toISOString()): Prepared {
  const input = object(raw);
  const op = choice(input.op, ["read", "evidence", "run", "flag_run", "notes", "critic", "verdict", "export"], "op");
  if (op === "read") {
    const view = input.view === undefined ? "summary" : choice(input.view, ["summary", "full", "receipts"], "view");
    if (view === "receipts") {
      const receipts = [...current(state).receipts].reverse();
      const offset = input.offset === undefined ? 0 : integer(input.offset, "offset", 0, 10000);
      const limit = input.limit === undefined ? 12 : integer(input.limit, "limit", 1, 100);
      return { result: { total: receipts.length, offset, receipts: receipts.slice(offset, offset + limit), nextOffset: offset + limit < receipts.length ? offset + limit : null } };
    }
    return { result: view === "full" ? state.mission ?? null : summary(state) };
  }
  if (op === "export") return { result: current(state) };
  const m = current(state);
  const requestId = input.requestId === undefined ? toolCallId : text(input.requestId, "requestId", 200);
  const requestHash = hash(input);
  const previous = state.events.find(e => e.missionId === m.id && e.requestId === requestId);
  if (previous) {
    if (previous.requestHash !== requestHash) throw new ResearchError("requestId was already used with different input");
    return { result: { duplicate: true, ...object(previous.data) } };
  }
  active(state);
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
      }
      const claim = text(e.claim, "claim"); const stance = choice(e.stance, ["supports", "contradicts", "context"], "stance");
      const fingerprint = hash({ source, locator, claim: claim.replace(/\s+/g, " ").toLowerCase(), stance });
      const existing = m.evidence.find(v => v.fingerprint === fingerprint);
      if (existing) return { result: { duplicate: true, evidence: existing } };
      const evidence: Evidence = { source, locator, claim, stance, fingerprint, id: `E${m.evidence.length + 1}`, at,
        title: text(e.title, "title", 400), summary: text(e.summary, "summary"), receiptId: r.id };
      return emit("evidence_added", { evidence });
    }
    case "run": {
      if (m.mode === "web") throw new ResearchError("Experiment runs require data or mixed mode");
      const p = object(input.run, "run"); const r = receipt(m, p.receiptId);
      const primaryMetric = text(p.primaryMetric, "primaryMetric", 64); const direction = choice(p.direction, ["lower", "higher"], "direction");
      const first = m.runs[0];
      if (first && (first.primaryMetric !== primaryMetric || first.direction !== direction)) throw new ResearchError("Primary metric/direction cannot change within a mission");
      if (p.checksPassed !== undefined && typeof p.checksPassed !== "boolean") throw new ResearchError("checksPassed must be boolean");
      const value = r.metrics[primaryMetric]; const best = bestRun(m);
      let outcome: Run["outcome"];
      if (r.isError) outcome = "crash";
      else if (p.checksPassed === false || r.metricError || !Number.isFinite(value)) outcome = "checks_failed";
      else if (!best) outcome = "baseline";
      else outcome = (direction === "lower" ? value! < best.metrics[primaryMetric]! : value! > best.metrics[primaryMetric]!) ? "keep" : "discard";
      const run: Run = { id: `R${m.runs.length + 1}`, at, label: text(p.label, "label", 400), hypothesis: text(p.hypothesis, "hypothesis"),
        receiptId: r.id, primaryMetric, direction, metrics: r.metrics, outcome,
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
      const critic: Critic = { id: `C${m.critics.length + 1}`, at, evaluator: reviewer, receiptId: r.id,
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
