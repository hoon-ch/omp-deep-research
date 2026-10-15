import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASES, COMMON_FLAGS, type BenchCase } from "./cases.ts";
import { evaluate, type MissionResult } from "./evaluate.ts";
import { MAIN_MODEL, MAIN_THINKING, runMission } from "./rpc.ts";

/** Frozen suite configuration (segment 0). BENCH_CASES/BENCH_REPS exist for debugging only; experiments run the full suite. */
const REPS = Number(process.env.BENCH_REPS ?? 2);
const CONCURRENCY = 5;
const MISSION_TIMEOUT_MS = 16 * 60_000;
const only = process.env.BENCH_CASES?.split(",");
const cases = only ? CASES.filter(c => only.includes(c.id)) : CASES;
const fullSuite = !only && REPS === 2;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(import.meta.dirname, "results", stamp);
mkdirSync(outDir, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "drbench-"));

function quote(s: string) { return /^[\w@./:=,+-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, "\\$1")}"`; }
async function one(c: BenchCase, rep: number): Promise<MissionResult> {
  const dir = join(root, `${c.id}-${rep}`); const ws = join(dir, "ws"); const sessionDir = join(dir, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  if (c.fixture) cpSync(resolve(import.meta.dirname, "fixtures", c.fixture), ws, { recursive: true }); else mkdirSync(ws);
  const prompt = ["/deep-research", "--mode", c.mode, ...COMMON_FLAGS, ...c.flags, c.objective].map(quote).join(" ");
  const run = await runMission({ cwd: ws, sessionDir, prompt, timeoutMs: MISSION_TIMEOUT_MS });
  const result = evaluate(c, rep, run, sessionDir);
  writeFileSync(join(outDir, `${c.id}-${rep}.json`), JSON.stringify({ ...result, sessionDir, stderrTail: run.stderr.slice(-4000) }, null, 2));
  process.stderr.write(`[bench] ${c.id}#${rep} pass=${result.pass} tokens=${result.main.total + result.children.total} scouts=${result.ledger.scoutSpawns} ${Math.round(result.wallMs / 1000)}s\n`);
  return result;
}

const queue = cases.flatMap(c => Array.from({ length: REPS }, (_, rep) => ({ c, rep })));
const results: MissionResult[] = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) results.push(await one(job.c, job.rep));
}));
results.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.rep - b.rep);

const sum = (f: (r: MissionResult) => number) => results.reduce((s, r) => s + f(r), 0);
const mean = (f: (r: MissionResult) => number) => results.length ? sum(f) / results.length : 0;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]! : 0; };
const times = results.map(r => r.timeToVerdictMs);
const caseIds = [...new Set(results.map(r => r.caseId))];
const casesPassing = caseIds.filter(id => results.filter(r => r.caseId === id).every(r => r.pass));
const gateViolations = results.filter(r => !Object.values(r.gates).every(Boolean)).length;
const summary = {
  stamp, mainModel: `${MAIN_MODEL}:${MAIN_THINKING}`, reps: REPS, fullSuite, missions: results.length,
  metrics: {
    total_suite_tokens: sum(r => r.main.total + r.children.total),
    main_tokens: sum(r => r.main.total), child_tokens: sum(r => r.children.total),
    uncached_tokens: sum(r => r.main.input + r.main.output + r.main.cacheWrite + r.children.input + r.children.output + r.children.cacheWrite),
    output_tokens: sum(r => r.main.output + r.children.output),
    total_model_calls: sum(r => r.main.calls + r.children.calls),
    total_tool_calls: sum(r => r.main.toolCalls + r.children.toolCalls),
    total_scout_spawns: sum(r => r.ledger.scoutSpawns),
    mean_scouts_per_mission: mean(r => r.ledger.scoutSpawns),
    total_research_cost_usd: Number(sum(r => r.main.cost + r.children.cost).toFixed(4)),
    median_time_to_verdict_ms: pct(times, 0.5), p95_time_to_verdict_ms: pct(times, 0.95),
    research_completion_rate: mean(r => r.quality.completed ? 1 : 0),
    evidence_coverage_score: Number(mean(r => r.quality.coverage).toFixed(4)),
    answer_quality_score: Number(mean(r => r.quality.answer).toFixed(4)),
    incorrect_conclusions: sum(r => r.quality.incorrect ? 1 : 0),
    mission_pass_rate: mean(r => r.pass ? 1 : 0),
    cases_passing: casesPassing.length,
    budget_blocked_task_calls: sum(r => r.ledger.budgetBlocks),
    gate_violations: gateViolations,
    infra_errors: sum(r => r.infraErrors.length),
  },
  casesPassing,
  perCase: Object.fromEntries(caseIds.map(id => {
    const rs = results.filter(r => r.caseId === id);
    return [id, rs.map(r => ({ rep: r.rep, pass: r.pass, tokens: r.main.total + r.children.total, mainTokens: r.main.total, childTokens: r.children.total,
      scouts: r.ledger.scoutSpawns, critics: r.critics, toolCalls: r.main.toolCalls + r.children.toolCalls, ttvMs: r.timeToVerdictMs,
      disposition: r.verdict?.disposition ?? null, coverage: r.quality.coverage, answer: r.quality.answer,
      missing: [...r.quality.missingGroups.map(g => `group:${g}`), ...r.quality.missingFacts.map(f => `fact:${f}`), ...r.quality.forbiddenHits.map(f => `forbidden:${f}`)],
      gates: Object.entries(r.gates).filter(([, ok]) => !ok).map(([k]) => k), infra: r.infraErrors.length }))];
  })),
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
process.stderr.write(`[bench] results: ${outDir}\n`);
for (const [k, v] of Object.entries(summary.metrics)) console.log(`METRIC ${k}=${v}`);
// Hard invariants (budget, provenance, critic, accounting) fail the run; quality deltas are judged against the baseline.
if (gateViolations > 0) { console.error(`[bench] ${gateViolations} mission(s) violated a hard gate`); process.exit(2); }
