/**
 * Scores one benchmark run from the OMP session files it left behind. Independent of the extension's code: it reads the
 * raw ledger events and the host's own transcripts, so a change under test cannot change how it is measured.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ENTRY_TYPE = "io.github.hoon-ch.omp-deep-research.event.v1";
/** Source-acquisition tools. Control/delegation tools (deep_research, task, todo, ask, wait, yield…) are not acquisitions; a task's work is counted inside its child sessions. */
export const ACQUISITION_TOOLS: Record<string, true> = { read: true, grep: true, glob: true, find: true, ast_grep: true, web_search: true, fetch: true, github: true, recall: true, reflect: true, browser: true, lsp: true, bash: true, eval: true, search: true };
const isAcquisition = (name: string) => Object.hasOwn(ACQUISITION_TOOLS, name);

export interface Fact { name: string; re: string; files: string[] }
export interface Case { id: string; category: string; flags: string; objective: string; expected: "conclusive" | "inconclusive"; facts: Fact[]; contradictions?: string[]; requiresCritic?: boolean }
export interface Transcript { file: string; main: boolean; toolCalls: { name: string; key: string }[]; tokens: number; cost: number; models: string[] }
export interface RunScore {
  case: string; category: string; rep: number; expected: Case["expected"]; disposition: Case["expected"] | null; phase: string | null;
  acquisitions: { main: number; children: number; total: number; byTool: Record<string, number>; duplicates: number };
  otherTools: Record<string, number>; taskCalls: number; childSessions: number;
  tokens: { main: number; children: number; total: number }; cost: number; continuations: number;
  timeToVerdictMs: number | null; wallMs: number; exit: string;
  evidence: number; evidenceFiles: string[]; criticRecorded: number; criticCited: boolean;
  factsTotal: number; factsVerified: string[]; missingEvidence: string[];
  correct: boolean; prematureConclusive: boolean; prematureInconclusive: boolean; unresolvedContradiction: boolean;
}

function jsonl(file: string): Record<string, any>[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name.endsWith(".jsonl") && !name.startsWith(".") ? [p] : [];
  });
}
function callKey(name: string, args: unknown): string {
  const a = args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {};
  delete a.i; delete a.intent;
  return `${name}:${JSON.stringify(a, Object.keys(a).sort())}`;
}
/** Every transcript in a session directory; the top-level file is the main session, nested files are subagents. */
export function transcripts(sessDir: string): Transcript[] {
  return walk(sessDir).map(file => {
    const rows = jsonl(file); const t: Transcript = { file, main: relative(sessDir, file).split("/").length === 1, toolCalls: [], tokens: 0, cost: 0, models: [] };
    for (const r of rows) {
      if (r.type === "model_change" && typeof r.model === "string") t.models.push(r.model);
      if (r.type !== "message" || r.message?.role !== "assistant") continue;
      const u = r.message.usage;
      if (typeof u?.totalTokens === "number") t.tokens += u.totalTokens;
      if (typeof u?.cost?.total === "number") t.cost += u.cost.total;
      for (const c of r.message.content ?? []) if (c?.type === "toolCall") t.toolCalls.push({ name: String(c.name), key: callKey(String(c.name), c.arguments) });
    }
    return t;
  });
}
export function ledger(mainFile: string): Record<string, any>[] {
  return jsonl(mainFile).filter(r => r.type === "custom" && r.customType === ENTRY_TYPE).map(r => r.data);
}
/** Workspace-relative file paths named by an evidence locator (`a.ts:1-3; b.md (note)`). */
export function locatorFiles(locator: string, ws: string): string[] {
  return locator.split(";").map(s => s.replace(/\([^)]*\)\s*$/, "").trim()).filter(Boolean).map(s => {
    let p = s.replace(/(?::|#L)[0-9][0-9,+\-L]*$/, "");
    if (p.startsWith(ws + "/")) p = p.slice(ws.length + 1);
    return p.replace(/^\.\//, "");
  });
}

export function scoreRun(c: Case, rep: number, ws: string, sessDir: string, wallMs: number, exit: string): RunScore {
  const ts = transcripts(sessDir);
  const main = ts.find(t => t.main);
  const events = main ? ledger(main.file) : [];
  const count = (pred: (t: Transcript) => boolean) => ts.filter(pred).flatMap(t => t.toolCalls).filter(x => isAcquisition(x.name));
  const byTool: Record<string, number> = {}; const otherTools: Record<string, number> = {};
  let duplicates = 0;
  for (const t of ts) {
    const seen = new Set<string>();
    for (const x of t.toolCalls) {
      if (isAcquisition(x.name)) { byTool[x.name] = (byTool[x.name] ?? 0) + 1; if (seen.has(x.key)) duplicates++; seen.add(x.key); }
      else otherTools[x.name] = (otherTools[x.name] ?? 0) + 1;
    }
  }
  const mainAcq = count(t => t.main).length; const childAcq = count(t => !t.main).length;
  const created = events.find(e => e.type === "mission_created");
  const verdictEvent = events.filter(e => e.type === "verdict_issued").at(-1);
  const verdict = verdictEvent?.data?.verdict;
  const evidence: Record<string, any>[] = events.filter(e => e.type === "evidence_added").map(e => e.data.evidence);
  const phase = verdict ? (verdict.disposition === "conclusive" ? "completed" : "paused")
    : events.some(e => e.type === "pass_paused") ? "paused" : created ? "active" : null;
  const filesOf = (ids: string[]) => new Set(evidence.filter(e => ids.includes(e.id)).flatMap(e => locatorFiles(String(e.locator), ws)));
  const findings: { claim: string; evidenceIds: string[] }[] = verdict?.findings ?? [];
  const disposition = verdict?.disposition ?? null;
  // A fact counts only when a finding states it and cites evidence from a file that actually holds it.
  const verified = c.facts.filter(f => findings.some(fd => new RegExp(f.re, "i").test(fd.claim) && [...filesOf(fd.evidenceIds)].some(p => f.files.includes(p)))).map(f => f.name);
  const cited = filesOf(findings.flatMap(f => f.evidenceIds));
  const missingEvidence = c.expected === "conclusive" ? c.facts.filter(f => !f.files.some(p => cited.has(p))).map(f => f.name) : [];
  const criticCited = Boolean(verdict?.criticId);
  const correct = c.expected === "conclusive"
    ? disposition === "conclusive" && verified.length === c.facts.length && (!c.requiresCritic || criticCited)
    : disposition === "inconclusive";
  const caveats = (verdict?.caveats ?? []).join("\n");
  const citedIds = new Set(findings.flatMap(f => f.evidenceIds));
  const ignored = evidence.some(e => e.stance === "contradicts" && !citedIds.has(e.id) && !new RegExp(`\\b${e.id}\\b`).test(caveats));
  const unresolvedConflictCase = c.expected === "inconclusive" && (c.contradictions?.length ?? 0) > 0;
  return {
    case: c.id, category: c.category, rep, expected: c.expected, disposition, phase,
    acquisitions: { main: mainAcq, children: childAcq, total: mainAcq + childAcq, byTool, duplicates }, otherTools,
    taskCalls: main?.toolCalls.filter(x => x.name === "task").length ?? 0, childSessions: ts.filter(t => !t.main).length,
    tokens: { main: main?.tokens ?? 0, children: ts.filter(t => !t.main).reduce((s, t) => s + t.tokens, 0), total: ts.reduce((s, t) => s + t.tokens, 0) },
    cost: ts.reduce((s, t) => s + t.cost, 0), continuations: events.filter(e => e.type === "continuation_requested").length,
    timeToVerdictMs: created && verdictEvent ? Date.parse(verdictEvent.at) - Date.parse(created.at) : null, wallMs, exit,
    evidence: evidence.length, evidenceFiles: [...new Set(evidence.flatMap(e => locatorFiles(String(e.locator), ws)))].sort(),
    criticRecorded: events.filter(e => e.type === "critic_recorded").length, criticCited,
    factsTotal: c.facts.length, factsVerified: verified, missingEvidence, correct,
    prematureConclusive: disposition === "conclusive" && !correct,
    prematureInconclusive: c.expected === "conclusive" && disposition === "inconclusive",
    unresolvedContradiction: disposition === "conclusive" && (ignored || unresolvedConflictCase),
  };
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
/** Suite-level metrics. Counts are per suite pass (summed over cases, averaged over repetitions). */
export function aggregate(runs: RunScore[]) {
  const reps = new Set(runs.map(r => r.rep)).size || 1;
  const sum = (f: (r: RunScore) => number) => runs.reduce((s, r) => s + f(r), 0) / reps;
  const conclusive = runs.filter(r => r.expected === "conclusive"); const inconclusive = runs.filter(r => r.expected === "inconclusive");
  const facts = conclusive.reduce((s, r) => s + r.factsTotal, 0);
  return {
    runs: runs.length, reps,
    total_acquisition_calls: sum(r => r.acquisitions.total),
    main_acquisition_calls: sum(r => r.acquisitions.main), child_acquisition_calls: sum(r => r.acquisitions.children),
    duplicate_acquisition_calls: sum(r => r.acquisitions.duplicates),
    tokens_per_mission: Math.round(mean(runs.map(r => r.tokens.total))),
    cost_per_suite: Number(sum(r => r.cost).toFixed(4)),
    time_to_verdict_ms: median(runs.flatMap(r => r.timeToVerdictMs === null ? [] : [r.timeToVerdictMs])),
    research_completion_rate: runs.filter(r => r.disposition !== null).length / runs.length,
    correctly_conclusive_rate: conclusive.length ? conclusive.filter(r => r.correct).length / conclusive.length : null,
    correctly_inconclusive_rate: inconclusive.length ? inconclusive.filter(r => r.correct).length / inconclusive.length : null,
    accuracy: runs.filter(r => r.correct).length / runs.length,
    premature_stop_count: sum(r => Number(r.prematureConclusive) + Number(r.prematureInconclusive)),
    premature_conclusive_count: sum(r => Number(r.prematureConclusive)), premature_inconclusive_count: sum(r => Number(r.prematureInconclusive)),
    missing_required_evidence_count: sum(r => r.missingEvidence.length),
    unresolved_contradiction_count: sum(r => Number(r.unresolvedContradiction)),
    verified_claim_coverage: facts ? conclusive.reduce((s, r) => s + r.factsVerified.length, 0) / facts : null,
    source_diversity: Number(mean(runs.map(r => r.evidenceFiles.length)).toFixed(2)),
    continuations: sum(r => r.continuations),
  };
}
