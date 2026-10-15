import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASES } from "./cases.ts";
import { evaluate, type MissionResult } from "./evaluate.ts";

/**
 * Proves the frozen gates catch deliberate regressions: each mutation edits a copy of a real recorded mission session
 * and must flip the named check. Usage: node --experimental-strip-types bench/selftest.ts bench/results/<stamp>
 */
const LEDGER = "io.github.hoon-ch.omp-deep-research.event.v1";
type Rec = Record<string, any>;
const dir = process.argv[2];
if (!dir) throw new Error("usage: selftest.ts <results dir>");
const recorded = readdirSync(dir).filter(f => /^[A-J]-.+-\d+\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as MissionResult & { sessionDir: string });

function mutate(caseId: string, edit: (entries: Rec[], sessionDir: string) => Rec[]): MissionResult {
  const base = recorded.find(r => r.caseId === caseId && r.pass);
  if (!base) throw new Error(`no passing recorded mission for ${caseId}`);
  const copy = mkdtempSync(join(tmpdir(), "drbench-selftest-"));
  cpSync(base.sessionDir, copy, { recursive: true });
  const main = readdirSync(copy).filter(f => f.endsWith(".jsonl") && !f.startsWith(".")).sort().at(-1)!;
  const file = join(copy, main);
  const entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Rec);
  writeFileSync(file, edit(entries, copy).map(e => JSON.stringify(e)).join("\n") + "\n");
  const c = CASES.find(c => c.id === caseId)!;
  return evaluate(c, base.rep, { settled: true, timedOut: false, exitCode: 0, wallMs: base.wallMs, sessionFile: file, stderr: "", errors: [] }, copy);
}
const ledger = (e: Rec, type?: string) => e.type === "custom" && e.customType === LEDGER && (!type || e.data?.type === type);
const verdictOf = (es: Rec[]) => es.find(e => ledger(e, "verdict_issued"))!.data.data.verdict;
const missionId = (es: Rec[]) => es.find(e => ledger(e, "mission_created"))!.data.missionId;

const checks: [string, () => boolean][] = [
  ["unmutated J-critic still passes", () => mutate("J-critic", es => es).pass],
  ["grounded-search provider usage → counted once with reported total", () => {
    const before = mutate("A-simple", es => es);
    const after = mutate("A-simple", es => [...es, { type: "message", message: { role: "toolResult", toolName: "web_search",
      details: { response: { usage: { inputTokens: 1154, outputTokens: 1182, totalTokens: 4120 } } } } }]);
    return after.main.total - before.main.total === 4120 && after.main.calls - before.main.calls === 1
      && after.main.input - before.main.input === 1154 && after.main.output - before.main.output === 1182;
  }],
  ["critic bypass → criticHonored fails", () => { const r = mutate("J-critic", es => {
    const out = es.filter(e => !ledger(e, "critic_recorded")); delete verdictOf(out).criticId; return out; });
    return !r.gates.criticHonored && !r.pass; }],
  ["scout report recorded as evidence → noScoutEvidence fails", () => { const r = mutate("E-repo", es => {
    es.find(e => ledger(e, "evidence_added"))!.data.data.evidence.locator = "agent://ApiScout"; return es; });
    return !r.gates.noScoutEvidence && !r.pass; }],
  ["skipped research question → coverage < 1", () => { const r = mutate("E-repo", es => {
    const drop = es.find(e => ledger(e, "evidence_added") && /packages\/cli\//.test(e.data.data.evidence.locator));
    return es.filter(e => e !== drop); });
    return r.quality.coverage < 1 && !r.pass; }],
  ["wrong conclusion → answer < 1", () => { const r = mutate("B-two", es => {
    const v = verdictOf(es); v.summary = "Both default to 200 connections."; v.findings = [{ claim: "Both default to 200", evidenceIds: ["E1"] }]; v.caveats = []; return es; });
    return r.quality.answer < 1 && !r.pass; }],
  ["contradiction resolved toward the docs → incorrect", () => { const r = mutate("D-contradict", es => {
    verdictOf(es).summary += " The default request timeout is 30 seconds."; return es; });
    return r.quality.incorrect && !r.pass; }],
  ["scouts beyond --max-children → childrenWithinBudget fails", () => { const r = mutate("I-budget", es => {
    const at = es.findIndex(e => ledger(e, "mission_created"));
    es.splice(at + 1, 0, { type: "custom", customType: LEDGER, data: { schemaVersion: 1, id: "x", missionId: missionId(es), at: "2026-10-15T00:00:00.000Z", type: "tool_counted", data: { toolCallId: "fake", children: 2 } } });
    return es; });
    return !r.gates.childrenWithinBudget && !r.pass; }],
  ["unmetered subagent usage → accountingComplete fails", () => { const r = mutate("A-simple", (es, copy) => {
    mkdirSync(join(copy, "child")); writeFileSync(join(copy, "child", "Scout.jsonl"), es.map(e => JSON.stringify(e)).join("\n"));
    return es.filter(e => !(ledger(e, "usage_recorded") && e.data.data.source === "children")); });
    return r.children.total > 0 && !r.gates.accountingComplete && !r.pass; }],
  ["timeout without verdict → not completed", () => { const r = mutate("A-simple", es => es.filter(e => !ledger(e, "verdict_issued")));
    return !r.quality.completed && !r.pass; }],
];
let failed = 0;
for (const [name, check] of checks) {
  let ok = false; let error = "";
  try { ok = check(); } catch (e) { error = ` (${e instanceof Error ? e.message : String(e)})`; }
  if (!ok) failed++;
  console.log(`${ok ? "detected" : "MISSED  "}  ${name}${error}`);
}
console.log(`METRIC selftest_missed=${failed}`);
if (failed) process.exit(1);
