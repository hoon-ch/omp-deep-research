import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchCase } from "./cases.ts";
import type { MissionRun } from "./rpc.ts";

/** Frozen evaluator (segment 0). It reads raw session files only, never the extension's code, so product changes cannot move it. */
const LEDGER = "io.github.hoon-ch.omp-deep-research.event.v1";
const CRITIC_AGENT = "deep-research-critic";
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; calls: number; toolCalls: number }
const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, calls: 0, toolCalls: 0 });
function addUsage(u: Usage, raw: unknown) {
  if (!isRec(raw)) return;
  const input = num(raw.input), output = num(raw.output), cacheRead = num(raw.cacheRead), cacheWrite = num(raw.cacheWrite);
  u.input += input; u.output += output; u.cacheRead += cacheRead; u.cacheWrite += cacheWrite;
  u.total += num(raw.totalTokens) || input + output + cacheRead + cacheWrite;
  u.cost += isRec(raw.cost) ? num(raw.cost.total) : 0;
}

export interface MissionResult {
  caseId: string; rep: number; settled: boolean; timedOut: boolean; wallMs: number; timeToVerdictMs: number; errors: string[]; infraErrors: string[];
  main: Usage; children: Usage; childFiles: number; webSearches: number;
  ledger: { tokens: number; childTokens: number; toolCalls: number; children: number; scoutSpawns: number; criticSpawns: number; budgetBlocks: number };
  evidence: { source: string; locator: string; stance: string }[];
  verdict?: { disposition: string; text: string; criticId?: string };
  critics: number;
  quality: { completed: boolean; coverage: number; answer: number; incorrect: boolean; missingGroups: string[]; missingFacts: string[]; forbiddenHits: string[] };
  gates: { childrenWithinBudget: boolean; noScoutEvidence: boolean; criticHonored: boolean; accountingComplete: boolean };
  pass: boolean;
}

function jsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.isFile() && e.name.endsWith(".jsonl") && !e.name.startsWith(".")) out.push(p);
  }
  return out;
}
function entries(file: string): Rec[] {
  const out: Rec[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line) as unknown; if (isRec(v)) out.push(v); } catch { /* lenient like OMP's loader */ }
  }
  return out;
}
/** Provider-reported usage of every assistant message and out-of-transcript model call in a session file. */
function fileUsage(es: Rec[], u: Usage, toolNames: Map<string, number>) {
  for (const e of es) {
    if (e.type === "model_usage") { addUsage(u, e.usage); u.calls++; continue; }
    if (e.type !== "message" || !isRec(e.message) || e.message.role !== "assistant") continue;
    addUsage(u, e.message.usage); u.calls++;
    for (const c of Array.isArray(e.message.content) ? e.message.content : []) {
      if (isRec(c) && c.type === "toolCall") { u.toolCalls++; const n = String(c.name); toolNames.set(n, (toolNames.get(n) ?? 0) + 1); }
    }
  }
}
const INFRA = /\b(?:429|5\d\d)\b|quota|rate.?limit|overloaded|credits|RESOURCE_EXHAUSTED/i;

export function evaluate(c: BenchCase, rep: number, run: MissionRun, sessionDir: string): MissionResult {
  const files = jsonlFiles(sessionDir);
  const mainFile = run.sessionFile && files.includes(run.sessionFile) ? run.sessionFile
    : files.filter(f => !f.slice(sessionDir.length + 1).includes("/")).sort().at(-1);
  const main = zero(); const children = zero(); const toolNames = new Map<string, number>();
  let mainEntries: Rec[] = [];
  for (const f of files) {
    const es = entries(f);
    if (f === mainFile) { mainEntries = es; fileUsage(es, main, toolNames); } else fileUsage(es, children, toolNames);
  }
  const infraErrors: string[] = [];
  for (const f of files) for (const e of entries(f)) {
    if (e.type === "message" && isRec(e.message) && e.message.role === "assistant" && e.message.stopReason === "error" && INFRA.test(String(e.message.errorMessage ?? "")))
      infraErrors.push(String(e.message.errorMessage).slice(0, 200));
  }
  // Main-session tool call arguments and results, keyed by tool call id.
  const args = new Map<string, Rec>(); const results = new Map<string, { isError: boolean; text: string }>();
  for (const e of mainEntries) {
    if (e.type !== "message" || !isRec(e.message)) continue;
    const m = e.message;
    if (m.role === "assistant") for (const c of Array.isArray(m.content) ? m.content : []) {
      if (isRec(c) && c.type === "toolCall" && typeof c.id === "string") args.set(c.id, isRec(c.arguments) ? c.arguments : {});
    }
    if (m.role === "toolResult" && typeof m.toolCallId === "string") {
      const text = (Array.isArray(m.content) ? m.content : []).map(c => isRec(c) && typeof c.text === "string" ? c.text : "").join("\n");
      results.set(m.toolCallId, { isError: m.isError === true, text });
    }
  }
  const events = mainEntries.filter(e => e.type === "custom" && e.customType === LEDGER && isRec(e.data)).map(e => e.data as Rec);
  const ledger = { tokens: 0, childTokens: 0, toolCalls: 0, children: 0, scoutSpawns: 0, criticSpawns: 0, budgetBlocks: 0 };
  const evidence: MissionResult["evidence"] = []; let verdictRaw: Rec | undefined; let critics = 0; let createdAt: number | undefined;
  const released = new Map<string, number>();
  for (const ev of events) if (ev.type === "children_released" && isRec(ev.data)) released.set(String(ev.data.toolCallId), num(ev.data.children));
  for (const ev of events) {
    const d = isRec(ev.data) ? ev.data : {};
    switch (ev.type) {
      case "mission_created": createdAt = Date.parse(String(ev.at)); break;
      case "usage_recorded": ledger.tokens += num(d.tokens); if (d.source === "children") ledger.childTokens += num(d.tokens); break;
      case "tool_counted": {
        ledger.toolCalls++;
        const n = num(d.children); if (!n) break;
        const net = n - (released.get(String(d.toolCallId)) ?? 0);
        ledger.children += net;
        const a = args.get(String(d.toolCallId)) ?? {};
        const items = Array.isArray(a.tasks) ? a.tasks.filter(isRec) : [a];
        const critic = items.filter(t => t.agent === CRITIC_AGENT).length;
        ledger.criticSpawns += Math.min(critic, net); ledger.scoutSpawns += Math.max(0, net - critic);
        break;
      }
      case "evidence_added": if (isRec(d.evidence)) evidence.push({ source: String(d.evidence.source), locator: String(d.evidence.locator), stance: String(d.evidence.stance) }); break;
      case "critic_recorded": critics++; break;
      case "verdict_issued": if (isRec(d.verdict)) verdictRaw = d.verdict; break;
    }
  }
  for (const [id, a] of args) {
    const r = results.get(id);
    if (r?.isError && /Subagent budget/.test(r.text) && (Array.isArray(a.tasks) || typeof a.agent === "string")) ledger.budgetBlocks++;
  }
  const verdict = verdictRaw && {
    disposition: String(verdictRaw.disposition),
    text: [verdictRaw.summary, ...(Array.isArray(verdictRaw.findings) ? verdictRaw.findings.map(f => isRec(f) ? f.claim : "") : []),
      ...(Array.isArray(verdictRaw.caveats) ? verdictRaw.caveats : [])].map(String).join("\n"),
    ...(typeof verdictRaw.criticId === "string" ? { criticId: verdictRaw.criticId } : {}),
  };
  const completed = verdict?.disposition === "conclusive";
  const missingGroups = Object.entries(c.groups).filter(([, res]) => !evidence.some(e => e.source !== "listing" && res.some(re => re.test(e.locator)))).map(([k]) => k);
  const text = verdict?.text ?? "";
  const missingFacts = Object.entries(c.facts).filter(([, re]) => !re.test(text)).map(([k]) => k);
  const forbiddenHits = Object.entries(c.forbidden).filter(([, re]) => re.test(text)).map(([k]) => k);
  const groupCount = Object.keys(c.groups).length; const factCount = Object.keys(c.facts).length;
  const quality = {
    completed, missingGroups, missingFacts, forbiddenHits, incorrect: forbiddenHits.length > 0,
    coverage: (groupCount - missingGroups.length) / groupCount,
    answer: forbiddenHits.length ? 0 : (factCount - missingFacts.length) / factCount,
  };
  const gates = {
    childrenWithinBudget: ledger.children <= c.maxChildren,
    noScoutEvidence: !evidence.some(e => /^agent:\/\//.test(e.locator)),
    criticHonored: !c.requireCritic || !completed || (critics > 0 && verdict?.criticId !== undefined),
    // Subagent usage the provider reported must reach the mission ledger.
    accountingComplete: children.total === ledger.childTokens,
  };
  const verdictAt = verdictRaw ? Date.parse(String(verdictRaw.at)) : NaN;
  return {
    caseId: c.id, rep, settled: run.settled, timedOut: run.timedOut, wallMs: run.wallMs, errors: run.errors, infraErrors,
    timeToVerdictMs: createdAt !== undefined && Number.isFinite(verdictAt) ? verdictAt - createdAt : run.wallMs,
    main, children, childFiles: files.length - (mainFile ? 1 : 0), webSearches: toolNames.get("web_search") ?? 0,
    ledger, evidence, ...(verdict ? { verdict } : {}), critics, quality, gates,
    pass: completed && run.settled && !run.timedOut && run.exitCode === 0 && !run.errors.length && !infraErrors.length
      && main.total > 0 && !quality.missingGroups.length && !quality.missingFacts.length && !quality.incorrect
      && Object.values(gates).every(Boolean) && (!c.requireCritic || critics > 0),
  };
}
