/**
 * Runs the frozen evidence-stopping suite against this checkout through headless OMP and prints METRIC lines.
 *
 *   node --experimental-strip-types bench/stopping/run.ts --label base [--reps 1] [--concurrency 5] [--cases C01,C05]
 *
 * Each run gets a fresh copy of bench/stopping/corpus as its workspace (no answer key) and its own session directory. Only this
 * checkout's extension is loaded (`--no-extensions -e`), long-term memory is off and the main model is pinned.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, scoreRun, type Case, type RunScore } from "./score.ts";

const BENCH = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(BENCH, "../..");
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback; };
const label = arg("label", `run-${Date.now()}`);
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(label)) throw new Error("Benchmark label must be a single path-safe name");
const reps = Number(arg("reps", "1")); const concurrency = Number(arg("concurrency", "5"));
const model = arg("model", process.env.BENCH_MODEL ?? "openai-codex/gpt-6.1-sol");
const thinking = arg("thinking", "high");
const timeoutMs = Number(arg("timeout-min", "30")) * 60_000;
const suite = JSON.parse(readFileSync(join(BENCH, "cases.json"), "utf8")) as { cases: Case[] };
const only = arg("cases", "");
const cases = only ? suite.cases.filter(c => only.split(",").includes(c.id)) : suite.cases;
const root = join(tmpdir(), "drbench", label);
const outDir = join(BENCH, "results", "live", label);
if (existsSync(root) || existsSync(outDir)) throw new Error("Use a unique benchmark label; prior results and sessions must not be overwritten");
mkdirSync(outDir, { recursive: true });
// Runs load a snapshot taken at start, so editing the checkout during a long run cannot change the code under test.
const EXT = join(root, "extension");
for (const p of ["package.json", "index.ts", "src", "agents"]) cpSync(join(REPO, p), join(EXT, p), { recursive: true });

function runOne(c: Case, rep: number): Promise<RunScore> {
  const dir = join(root, `${c.id}-r${rep}`); const ws = join(dir, "ws"); const sess = join(dir, "sess");
  cpSync(join(BENCH, "corpus"), ws, { recursive: true }); mkdirSync(sess, { recursive: true });
  const started = Date.now();
  const child = spawn("omp", ["--mode", "rpc", "--no-ui", "--no-extensions", "-e", EXT, "--session-dir", sess, "--no-title", "--no-rules", "--no-skills",
    "--model", model, "--thinking", thinking, "--config", join(BENCH, "omp-overlay.yml")], { cwd: ws, stdio: ["pipe", "pipe", "pipe"] });
  const log: string[] = []; let buffer = ""; let agentStarted = false; let exit = "settled";
  const { promise, resolve: done } = Promise.withResolvers<RunScore>();
  const finish = () => { child.stdin.end(); setTimeout(() => child.kill("SIGTERM"), 15_000).unref(); };
  const hard = setTimeout(() => { exit = "timeout"; finish(); setTimeout(() => child.kill("SIGKILL"), 20_000).unref(); }, timeoutMs);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      let e: Record<string, unknown>; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== "message_update" && !String(e.type).endsWith("_delta")) log.push(line.slice(0, 2000));
      if (e.type === "ready") child.stdin.write(`${JSON.stringify({ type: "prompt", message: `/deep-research ${c.flags} "${c.objective}"` })}\n`);
      if (e.type === "agent_start") agentStarted = true;
      if (e.type === "session_settled" && agentStarted) finish();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => log.push(`[stderr] ${chunk.toString().trim()}`));
  child.on("exit", code => {
    clearTimeout(hard);
    if (exit === "settled" && !agentStarted) exit = `no-agent(${code})`;
    writeFileSync(join(outDir, `${c.id}-r${rep}.events.log`), log.join("\n"));
    const score = scoreRun(c, rep, ws, sess, Date.now() - started, exit);
    writeFileSync(join(outDir, `${c.id}-r${rep}.json`), JSON.stringify({ ...score, sessionDir: sess }, null, 2));
    process.stderr.write(`${c.id}-r${rep}: ${score.disposition ?? "no verdict"} correct=${score.correct} acq=${score.acquisitions.total} (${score.acquisitions.main}+${score.acquisitions.children}) ${Math.round(score.wallMs / 1000)}s\n`);
    done(score);
  });
  return promise;
}

const jobs = cases.flatMap(c => Array.from({ length: reps }, (_, i) => () => runOne(c, i + 1)));
const results: RunScore[] = [];
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await job());
}));
results.sort((a, b) => a.case.localeCompare(b.case) || a.rep - b.rep);
const summary = aggregate(results);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ label, model, thinking, summary, runs: results }, null, 2));
for (const [k, v] of Object.entries(summary)) if (typeof v === "number") console.log(`METRIC ${k}=${Number.isInteger(v) ? v : v.toFixed(4)}`);
