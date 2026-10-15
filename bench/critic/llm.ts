/**
 * Measurement segment 2: fixed 22-invocation schedule; every attempt (including failed/repeated calls) contributes to
 * cost. Fixture judgments are unchanged. The consumer's receipt parser/engine verifies answers separately from semantic
 * label scoring. Plant-ID references are diagnostics only: independent semantic review supplies detection rates.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, stable } from "../../src/validation.ts";
import { AGENT_BODY, assignment, brief, CRITIC_MODEL, recordCritic } from "./common.ts";
import { buildCases, caseHash } from "./fixtures.ts";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const label = arg("label") ?? "candidate";
const dir = process.env.CRITIC_BENCH_RESULTS_DIR ?? new URL("./results/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const file = join(dir, `${label}.jsonl`);
const cases = buildCases();
const lock = JSON.parse(readFileSync(new URL("./fixtures.lock.json", import.meta.url), "utf8"));
if (!isRecord(lock) || Object.keys(lock).length !== cases.length || cases.some(c => lock[c.id] !== caseHash(c)))
  throw new Error("Frozen fixture/reference lock changed; start a separately documented benchmark segment.");
const suiteHash = createHash("sha256").update(stable(lock)).digest("hex");
const REPEATED = ["A-small-clean-5", "B-large-clean-25", "B-large-clean-100", "B-large-clean-500"];
interface Usage { inputTokens: number; cacheRead: number; outputTokens: number; usageMessages: number }
interface Invocation extends Usage { answer: string; latencyMs: number; actualModels: string[]; error?: string }
interface Result extends Invocation { segment: 2; suiteHash: string; case: string; attempt: number; sha256: string }
const done: Result[] = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
if (done.some(r => r.segment !== 2 || r.suiteHash !== suiteHash)) throw new Error("Result belongs to another measurement segment: choose a new --label.");

function invoke(text: string): Promise<Invocation> {
  const started = Date.now();
  const { promise, resolve } = Promise.withResolvers<Invocation>();
  const child = spawn("omp", ["-p", "--mode", "json", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title",
    "--model", CRITIC_MODEL, "--thinking", "high", "--system-prompt", AGENT_BODY, text], { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 });
  let out = ""; let err = "";
  child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { err += d; });
  child.once("error", error => { err += error.message; });
  child.once("close", code => {
    const usage: Usage = { inputTokens: 0, cacheRead: 0, outputTokens: 0, usageMessages: 0 };
    let answer = ""; const actualModels = new Set<string>();
    for (const line of out.split("\n")) {
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { continue; }
      if (!isRecord(frame) || frame.type !== "message_end" || !isRecord(frame.message)) continue;
      const m = frame.message;
      if (m.role !== "assistant") continue;
      if (typeof m.provider === "string" && typeof m.model === "string") actualModels.add(`${m.provider}/${m.model}`);
      if (isRecord(m.usage) && typeof m.usage.input === "number" && typeof m.usage.output === "number") {
        const cached = typeof m.usage.cacheRead === "number" ? m.usage.cacheRead : 0;
        usage.inputTokens += m.usage.input + cached;
        usage.cacheRead += cached; usage.outputTokens += m.usage.output; usage.usageMessages++;
      }
      if (Array.isArray(m.content)) answer = m.content.filter(isRecord).filter(c => c.type === "text" && typeof c.text === "string").map(c => c.text).join("");
    }
    resolve({ ...usage, answer, latencyMs: Date.now() - started, actualModels: [...actualModels],
      ...(code === 0 && answer && usage.usageMessages ? {} : { error: `exit ${code}; usageMessages=${usage.usageMessages}: ${err.slice(-500)}` }) });
  });
  return promise;
}
const selected = arg("cases")?.split(",") ?? cases.map(c => c.id);
const schedule = cases.filter(c => selected.includes(c.id)).flatMap(c => {
  const b = brief(c.entries); const text = assignment(b.instructions, b.snapshot);
  const sha256 = createHash("sha256").update(stable({ system: AGENT_BODY, text, model: CRITIC_MODEL, thinking: "high", suiteHash })).digest("hex");
  return Array.from({ length: REPEATED.includes(c.id) ? 2 : 1 }, (_, i) => ({ c, text, sha256, attempt: i + 1 }));
});
if (!process.argv.includes("--score")) {
  const queue = schedule.filter(s => !done.some(r => r.case === s.c.id && r.attempt === s.attempt && r.sha256 === s.sha256));
  await Promise.all(Array.from({ length: Number(arg("concurrency") ?? 6) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await invoke(s.text);
      const row: Result = { segment: 2, suiteHash, case: s.c.id, attempt: s.attempt, sha256: s.sha256, ...r };
      appendFileSync(file, JSON.stringify(row) + "\n"); done.push(row);
      console.log(`${s.c.id} #${s.attempt}: ${r.error ?? "ok"} in=${r.inputTokens} out=${r.outputTokens} ${r.latencyMs}ms`);
    }
  }));
}
const scored = schedule.map(s => {
  const rows = done.filter(r => r.case === s.c.id && r.sha256 === s.sha256 && r.attempt === s.attempt);
  const r = rows.at(-1);
  const identityValid = !!r && r.actualModels.length === 1 && r.actualModels[0] === CRITIC_MODEL;
  let assessment = r && !identityValid ? "wrong-or-missing-model" : "missing";
  if (r && !r.error && identityValid) {
    try {
      const v: unknown = JSON.parse(r.answer);
      if (isRecord(v) && (v.assessment === "pass" || v.assessment === "revise")) assessment = v.assessment;
    } catch { assessment = "unparsed"; }
  }
  const recorded = r && identityValid
    ? recordCritic(structuredClone(s.c.entries), { task: s.text, resolvedModel: r.actualModels[0] }, r.answer)
    : { ok: false, error: r ? "Unverified actual critic model" : "Missing invocation" };
  return { ...s, r, assessment, identityValid, accepted: recorded.ok, acceptError: "error" in recorded ? recorded.error : undefined };
});
for (const s of scored) console.log(`${s.c.id} #${s.attempt}: expected=${s.c.expected.assessment} got=${s.assessment} accepted=${s.accepted}${s.acceptError ? ` (${s.acceptError})` : ""}`);
// Cost aggregation is deliberately independent of final-answer selection: no overwritten/failed/duplicate attempt disappears.
const accounted = done.filter(r => selected.includes(r.case));
const total = accounted.reduce((n, r) => n + r.inputTokens, 0);
const accuracy = (expected: string) => {
  const rows = scored.filter(s => s.c.expected.assessment === expected);
  return rows.filter(s => s.assessment === expected).length / Math.max(1, rows.length);
};
console.log(`METRIC llm_expected_invocations=${schedule.length}`);
console.log(`METRIC llm_observed_invocations=${accounted.length}`);
console.log(`METRIC llm_missing_invocations=${scored.filter(s => !s.r).length}`);
console.log(`METRIC llm_usage_missing_count=${accounted.filter(r => !r.usageMessages).length}`);
console.log(`METRIC critic_input_tokens_measured=${total}`);
console.log(`METRIC critic_input_tokens=${total}`);
console.log(`METRIC critic_input_tokens_per_review=${Math.round(total / Math.max(1, accounted.length))}`);
console.log(`METRIC critic_latency_ms=${Math.round(accounted.reduce((n, r) => n + r.latencyMs, 0) / Math.max(1, accounted.length))}`);
console.log(`METRIC critic_pass_accuracy=${accuracy("pass")}`);
console.log(`METRIC critic_revise_accuracy=${accuracy("revise")}`);
console.log(`METRIC critic_false_pass_count=${scored.filter(s => s.c.expected.assessment === "revise" && s.assessment === "pass").length}`);
console.log(`METRIC critic_false_revise_count=${scored.filter(s => s.c.expected.assessment === "pass" && s.assessment === "revise").length}`);
console.log(`METRIC critic_answer_rejected_count=${scored.filter(s => !s.accepted).length}`);
console.log(`METRIC critic_model_identity_failure_count=${scored.filter(s => !s.identityValid).length}`);
