/**
 * Real critic judgments for the frozen suite: each case's critic assignment goes to the configured critic model through
 * `omp -p` (the plugin's critic agent body as system prompt, no tools), and the answer is scored against the case's
 * fixed reference judgment and recorded through the real op:"critic" path. Usage input tokens are the provider's
 * reported counts for that direct invocation; an OMP subagent spawn adds the host scaffold on top.
 *
 *   node --experimental-strip-types bench/critic/llm.ts --label baseline [--cases A-small-clean-5,E-contradiction-25] [--concurrency 6]
 *   node --experimental-strip-types bench/critic/llm.ts --label baseline --score
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { AGENT_BODY, assignment, brief, CRITIC_MODEL, recordCritic } from "./common.ts";
import { buildCases, type Case } from "./fixtures.ts";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? undefined : process.argv[i + 1]; };
const label = arg("label") ?? "run";
const dir = new URL("./results/", import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const file = `${dir}${label}.jsonl`;

interface Result { case: string; sha256: string; inputTokens: number; cacheRead: number; outputTokens: number; latencyMs: number; answer: string; error?: string }
const done: Result[] = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Result) : [];

function invoke(text: string): Promise<Omit<Result, "case" | "sha256">> {
  const started = Date.now();
  const { promise, resolve } = Promise.withResolvers<Omit<Result, "case" | "sha256">>();
  const child = spawn("omp", ["-p", "--mode", "json", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title",
    "--model", CRITIC_MODEL, "--thinking", "high", "--system-prompt", AGENT_BODY, text], { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; let err = "";
  child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { err += d; });
  child.on("close", code => {
    let usage = { input: 0, cacheRead: 0, output: 0 }; let answer = "";
    for (const line of out.split("\n")) {
      if (!line.startsWith("{\"type\":\"message_end\"")) continue;
      const m = JSON.parse(line).message;
      if (m?.role !== "assistant") continue;
      usage = m.usage; answer = m.content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    }
    resolve({ inputTokens: usage.input + usage.cacheRead, cacheRead: usage.cacheRead, outputTokens: usage.output, latencyMs: Date.now() - started, answer,
      ...(code === 0 && answer ? {} : { error: `exit ${code}: ${err.slice(-500)}` }) });
  });
  return promise;
}

const cases = buildCases();
const selected = arg("cases")?.split(",") ?? cases.map(c => c.id);
const texts = new Map(cases.map(c => { const b = brief(c.entries); return [c.id, assignment(b.instructions, b.snapshot)]; }));
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

if (!process.argv.includes("--score")) {
  const queue = cases.filter(c => selected.includes(c.id) && !done.some(d => d.case === c.id && d.sha256 === sha(texts.get(c.id)!)));
  const workers = Array.from({ length: Number(arg("concurrency") ?? 6) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const text = texts.get(c.id)!; const r = await invoke(text);
      const row: Result = { case: c.id, sha256: sha(text), ...r };
      appendFileSync(file, `${JSON.stringify(row)}\n`); done.push(row);
      console.log(`${c.id}: ${r.error ?? "ok"} in=${r.inputTokens} out=${r.outputTokens} ${r.latencyMs}ms`);
    }
  });
  await Promise.all(workers);
}

// --- scoring ----------------------------------------------------------------------------------------------------------
function parse(answer: string): { assessment?: string; concerns: string[]; summary: string } {
  const start = answer.indexOf("{"); const end = answer.lastIndexOf("}");
  try {
    const v = JSON.parse(answer.slice(start, end + 1));
    return { assessment: v.assessment, concerns: Array.isArray(v.concerns) ? v.concerns.map(String) : [], summary: String(v.summary ?? "") };
  } catch { return { concerns: [], summary: "" }; }
}
const rows = cases.filter(c => selected.includes(c.id)).map(c => {
  // The latest answer for the current assignment; a changed packet never reuses an answer to another one.
  const r = done.filter(d => d.case === c.id && d.sha256 === sha(texts.get(c.id)!)).at(-1);
  return { c, r };
}).filter((x): x is { c: Case; r: Result } => !!x.r);
const scored = rows.map(({ c, r }) => {
  const a = parse(r.answer); const text = [...a.concerns, a.summary].join("\n");
  const plants = c.expected.plants.map(p => ({ kind: p.kind, detected: a.assessment === "revise" && (p.ids.some(id => new RegExp(`\\b${id}\\b`).test(text)) || (p.keywords ?? []).some(k => text.toLowerCase().includes(k))) }));
  const recorded = recordCritic(structuredClone(c.entries), { task: texts.get(c.id)! }, r.answer);
  return { id: c.id, expected: c.expected.assessment, got: a.assessment ?? "unparsed", plants, accepted: recorded.ok, acceptError: recorded.ok ? undefined : recorded.error, r };
});
const rate = (xs: boolean[]) => xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 1000) / 1000 : NaN;
const plantRate = (kind: string) => rate(scored.flatMap(s => s.plants.filter(p => p.kind === kind).map(p => p.detected)));
for (const s of scored) {
  console.log(`${s.id.padEnd(26)} expected=${s.expected.padEnd(6)} got=${s.got.padEnd(6)} plants=${s.plants.map(p => `${p.kind}:${p.detected ? "hit" : "MISS"}`).join(",") || "-"} in=${s.r.inputTokens} ${s.r.latencyMs}ms${s.accepted ? "" : ` NOT-RECORDED(${s.acceptError?.slice(0, 80)})`}`);
}
const total = scored.reduce((n, s) => n + s.r.inputTokens, 0);
console.log(`METRIC llm_cases=${scored.length}`);
console.log(`METRIC critic_input_tokens_measured=${total}`);
console.log(`METRIC critic_latency_ms=${Math.round(scored.reduce((n, s) => n + s.r.latencyMs, 0) / Math.max(1, scored.length))}`);
console.log(`METRIC critic_pass_accuracy=${rate(scored.filter(s => s.expected === "pass").map(s => s.got === "pass"))}`);
console.log(`METRIC critic_revise_accuracy=${rate(scored.filter(s => s.expected === "revise").map(s => s.got === "revise"))}`);
console.log(`METRIC critic_false_pass_count=${scored.filter(s => s.expected === "revise" && s.got === "pass").length}`);
console.log(`METRIC critic_false_revise_count=${scored.filter(s => s.expected === "pass" && s.got === "revise").length}`);
console.log(`METRIC unsupported_claim_detection_rate=${plantRate("unsupported")}`);
console.log(`METRIC contradiction_detection_rate=${plantRate("contradiction")}`);
console.log(`METRIC invalid_run_detection_rate=${plantRate("invalid_run")}`);
console.log(`METRIC incomplete_detection_rate=${plantRate("incomplete")}`);
console.log(`METRIC critic_answer_recorded_rate=${rate(scored.map(s => s.accepted))}`);
