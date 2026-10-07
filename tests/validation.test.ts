import test from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalUrl, hash, parseHarnessOutput } from "../src/validation.ts";
import { parseCommand, specConfig, tokenize } from "../src/command.ts";
import { DEFAULT_SETTINGS } from "../src/engine.ts";
import { blockedReason, intakeBlockedReason } from "../src/policy.ts";
import { buildReceipt, locatorRefs, snapshotHash } from "../src/receipts.ts";
import { parseSpec } from "../src/spec.ts";
import { Ledger } from "./helpers.ts";
const CWD = "/research-root";

test("parses finite metrics including exponent and negative values", () => {
  assert.deepEqual({ ...parseHarnessOutput("METRIC score=1e-3\nMETRIC loss=-.5\nother output").metrics }, { score: .001, loss: -.5 });
});
test("malformed, duplicate, NaN and infinite metrics invalidate the result", () => {
  for (const s of ["METRIC score=NaN", "METRIC x=Infinity", "METRIC x=1e999", "METRIC x=1\nMETRIC x=2", "METRIC score=nope", "METRIC __proto__=1"])
    assert.ok(parseHarnessOutput(s).error);
});
test("ASI lines are typed learning data and never invalidate metrics", () => {
  const p = parseHarnessOutput("ASI cache=warm\nASI threads=8\nASI jit=false\nASI __proto__=x\nASI bad line\nASI cache=cold\nMETRIC ms=4");
  assert.deepEqual({ ...p.asi }, { cache: "warm", threads: 8, jit: false }); assert.equal(p.error, undefined); assert.equal(p.metrics.ms, 4);
});
test("spec intake requires an explicit mode and reads objective, sections and metric", () => {
  const spec = "# Compare JSON parsers\n\n- autoresearch-mode: data\ndeep-research-metric: ms\ndeep-research-metric-direction: lower\n\n## Constraints\n- No product edits\n\n## Acceptance criteria\n- [ ] Ranked table\n- [x] Caveats listed\n";
  assert.deepEqual(parseSpec(spec, "s.md"), { objective: "Compare JSON parsers", mode: "data", constraints: ["No product edits"],
    deliverables: ["Ranked table", "Caveats listed"], metric: { name: "ms", direction: "lower" } });
  assert.throws(() => parseSpec("# Goal\n## Deliverables\n- x", "s.md"), /must declare its mode/);
  assert.throws(() => parseSpec("deep-research-mode: web\ndeep-research-metric: ms", "s.md"), /both/);
  const source = { path: "/s.md", sha256: "a".repeat(64) };
  assert.throws(() => specConfig(parseSpec(spec, "s.md"), structuredClone(DEFAULT_SETTINGS), source, "web"), /contradicts/);
  const config = specConfig(parseSpec(spec, "s.md"), { ...structuredClone(DEFAULT_SETTINGS), allowHarness: true }, source);
  assert.equal(config.mode, "data"); assert.equal(config.spec!.sha256, source.sha256); assert.ok(config.constraints.includes("No product edits"));
});
test("operator commands parse spec, mode change, metric and usage budgets", () => {
  const spec = parseCommand("--spec plan.md --harness --max-tokens 50000 --max-cost 2.5");
  if (spec.op !== "spec") throw new Error("Expected spec");
  assert.equal(spec.path, "plan.md"); assert.equal(spec.settings.maxTokens, 50000); assert.equal(spec.settings.maxCost, 2.5);
  assert.deepEqual(parseCommand("mode mixed"), { op: "mode", mode: "mixed" });
  const metric = parseCommand("--mode data --metric ms --direction lower Compare");
  if (metric.op !== "start") throw new Error("Expected start");
  assert.deepEqual(metric.config.metric, { name: "ms", direction: "lower" });
  for (const c of ["--spec a.md extra words", "--metric ms --mode data x", "--mode data --metric ms --direction up x", "mode web extra", "--max-cost 0 --mode web x"])
    assert.throws(() => parseCommand(c));
});
test("execution consent commands reject ambiguous or extra arguments", () => {
  assert.deepEqual(parseCommand("allow harness"), { op: "allow", permission: "harness" });
  assert.deepEqual(parseCommand("allow exec"), { op: "allow", permission: "exec" });
  assert.deepEqual(parseCommand("deny"), { op: "deny" });
  for (const command of ["allow", "allow all", "allow harness exec", "allow --harness", "deny exec"])
    assert.throws(() => parseCommand(command));
});
const DIGEST = "a".repeat(64);
const REVIEW = { assessment: "pass", summary: "Defensible", concerns: [], evidenceIds: ["E1"], evidenceDigest: DIGEST };
test("task receipts keep each agent's own pin, reported model and structured answer", () => {
  const resolve = (s: string) => s === "critic" ? { provider: "test", id: "critic" } : s === "helper" ? { provider: "test", id: "helper" } : undefined;
  const spawned = buildReceipt({ toolName: "task", toolCallId: "t1", isError: false,
    input: { context: "c", tasks: [{ agent: "scout", model: "helper" }, { agent: "scout", model: "critic" }, { agent: "scout", model: ["critic", "other"] }] },
    content: [{ type: "text", text: "Spawned 3 background agents" }],
    details: { results: [], progress: [{ index: 1, id: "Crit" }, { index: 0, id: "Help" }, { index: 2, id: "Any" }] } }, resolve, "/repo");
  assert.deepEqual(spawned.agents, [{ id: "Crit", requestedModel: "test/critic" }, { id: "Help", requestedModel: "test/helper" }, { id: "Any" }]);
  const blocking = buildReceipt({ toolName: "task", toolCallId: "t2", isError: false, input: { agent: "scout" }, content: [{ type: "text", text: "done" }],
    details: { results: [{ index: 0, id: "Rev", resolvedModel: "test/critic:high", structuredOutput: REVIEW },
      { index: 1, id: "Fb", resolvedModel: "test/other", resolvedModelIsFallback: true, output: `\`\`\`json\n${JSON.stringify(REVIEW)}\n\`\`\`` }] } }, resolve, "/repo");
  assert.deepEqual(blocking.agents, [{ id: "Rev", resolvedModel: "test/critic", review: REVIEW }, { id: "Fb", fallback: true, review: REVIEW }]);
});
test("read receipts separate opened URLs from links and parse a critic answer from raw content", () => {
  const read = (path: string, details: unknown, text: string) => buildReceipt({ toolName: "read", toolCallId: "r", isError: false, input: { path }, content: [{ type: "text", text }], details }, () => undefined, "/repo");
  const page = read("https://e.org/a", { kind: "url", url: "https://e.org/a", finalUrl: "https://www.e.org/a/" }, "URL: https://www.e.org/a/\n\nSee https://other.org/b");
  assert.deepEqual(page.opened, ["https://e.org/a", "https://www.e.org/a/"]); assert.deepEqual(page.links, ["https://www.e.org/a/", "https://other.org/b"]);
  assert.equal(page.review, undefined);
  const numbered = JSON.stringify(REVIEW, null, 2).split("\n").map((line, i) => `${i + 1}:${line}`).join("\n");
  const critic = read("agent://Crit", { resolvedPath: "/home/.omp/artifacts/Crit.md", displayContent: { text: JSON.stringify(REVIEW), startLine: 1 } }, numbered);
  assert.deepEqual(critic.review, REVIEW); assert.deepEqual(critic.files, []);
  assert.equal(read("agent://Crit", {}, JSON.stringify({ ...REVIEW, evidenceDigest: "stale" })).review, undefined);
});
test("task receipts hash the critic snapshot each agent's own assignment carried", () => {
  const snapshot = { evidenceDigest: DIGEST, objective: "o", evidence: [{ id: "E1", claim: "c" }], segments: [], notes: "n" };
  const brief = { instructions: "Respond with ONLY this JSON object: {\"assessment\": \"pass|revise\"}", snapshot };
  const reordered = `Review this:\n\`\`\`json\n${JSON.stringify({ notes: "edited later", segments: [], evidence: [{ claim: "c", id: "E1" }], objective: "o", evidenceDigest: DIGEST }, null, 2)}\n\`\`\``;
  const receipt = buildReceipt({ toolName: "task", toolCallId: "t", isError: false, content: [{ type: "text", text: "Spawned" }],
    input: { context: JSON.stringify(brief), tasks: [{ task: "critic" }, { task: reordered }, { task: JSON.stringify({ ...snapshot, evidence: [] }) }] },
    details: { progress: [{ index: 0, id: "A" }, { index: 1, id: "B" }, { index: 2, id: "C" }] } }, () => undefined, "/repo");
  const expected = snapshotHash(snapshot); const [a, b, c] = receipt.agents!;
  assert.deepEqual(a!.briefs, [expected]); assert.deepEqual(b!.briefs, [expected]);
  assert.ok(c!.briefs!.includes(expected) && c!.briefs!.length === 2, "shared context plus an edited copy");
});
test("local receipts record files and the exact lines a result showed, never the searched scope", () => {
  const run = (tool: string, input: Record<string, unknown>, details: unknown) => buildReceipt({ toolName: tool, toolCallId: "r", isError: false, input, content: [{ type: "text", text: "x" }], details }, () => undefined, "/repo");
  // OMP 18.7.0 plain text read, as observed live: no resolvedPath, only meta.source; totalLines means it reached EOF.
  const lines4 = { text: "a\nb\nc\nd", startLine: 1, lineNumbers: [1, 2, 3, 4] };
  assert.deepEqual(run("read", { path: "server.js" }, { totalLines: 4, displayContent: lines4, meta: { source: { type: "path", value: "/repo/server.js" } } }).files,
    [{ path: "/repo/server.js", lines: [[1, 4]], complete: true }]);
  assert.deepEqual(run("read", { path: "big.ts" }, { resolvedPath: "/repo/big.ts", displayContent: lines4 }).files, [{ path: "/repo/big.ts", lines: [[1, 4]] }]);
  assert.deepEqual(run("read", { path: "log.md:125-127" }, { resolvedPath: "/repo/log.md", totalLines: 400, displayContent: { text: "x", startLine: 124, lineNumbers: [124, 125, 126, 127, null, 300] } }).files,
    [{ path: "/repo/log.md", lines: [[124, 127], [300, 300]] }]);
  assert.deepEqual(run("read", { path: "big.ts" }, { resolvedPath: "/repo/big.ts", summary: { lines: 9 }, displayContent: { text: "elided", startLine: 1 } }).files, [{ path: "/repo/big.ts" }]);
  assert.deepEqual(run("read", { path: "paper.pdf" }, { resolvedPath: "/repo/paper.pdf" }).files, [{ path: "/repo/paper.pdf", complete: true }]);
  assert.deepEqual(run("read", { path: "db.sqlite:users" }, { resolvedPath: "/repo/db.sqlite" }).files, [{ path: "/repo/db.sqlite" }]);
  assert.deepEqual(run("read", { path: "src" }, { resolvedPath: "/repo/src", isDirectory: true }).files, []);
  assert.deepEqual(run("read", { path: "a.ts;agent://X;missing.ts" }, { displayReadTargets: ["a.ts:1-9", "agent://X", "missing.ts"], displayReadTargetLinks: ["/repo/a.ts", "/tmp/X.md", null] }).files, [{ path: "/repo/a.ts" }]);
  assert.deepEqual(run("grep", { path: "src", pattern: "NO_SUCH_MATCH" }, { files: [], matchCount: 0 }).files, []);
  // Grouped grep display as observed live on OMP 18.7.0.
  const grouped = "# server.js#594D\n 3│const server = http.createServer();\n*4│server.listen(port);\n\n# lib/\n## config.js#5B6E\n*1│// Port\n*2│const DEFAULT_PORT = 8080;\n*3│module.exports = {};";
  assert.deepEqual(run("grep", { pattern: "x" }, { cwd: "/repo", files: ["lib/config.js", "server.js", "local://n.md"], displayContent: grouped }).files,
    [{ path: "/repo/lib/config.js", lines: [[1, 3]] }, { path: "/repo/server.js", lines: [[3, 4]] }]);
  assert.deepEqual(run("grep", { path: "a.ts", pattern: "x" }, { cwd: "/repo", files: ["a.ts"], displayContent: "  9│ctx\n*10│hit\n   │...\n*40│hit" }).files, [{ path: "/repo/a.ts", lines: [[9, 10], [40, 40]] }]);
  assert.deepEqual(run("glob", { path: "src/*" }, { cwd: "/repo", files: ["src/a.ts", "src/sub/"] }).listed, ["/repo/src/a.ts", "/repo/src/sub"]);
  assert.deepEqual(run("find", { query: "q" }, { cwd: "/repo", hits: [{ rel: "docs/b.md" }] }).listed, ["/repo/docs/b.md"]);
  for (const tool of ["glob", "find", "web_search"]) assert.equal(run(tool, { path: "src" }, { files: ["src/a.ts"] }).files, undefined);
});
test("locators name files with line ranges and nothing unchecked; a bare file cites all of it", () => {
  assert.deepEqual(locatorRefs("a.ts:10-20,30; b/c.md:4+3 (note, see f(x)), d.ts#L5-L9; /abs/e.ts(why)", "/repo"), [
    { file: "/repo/a.ts", ranges: [[10, 20], [30, 30]] }, { file: "/repo/b/c.md", ranges: [[4, 6]] }, { file: "/repo/d.ts", ranges: [[5, 9]] }, { file: "/abs/e.ts" }]);
  for (const bad of ["a.ts:20-10", "a.ts:0", "a.ts:5+0"]) assert.throws(() => locatorRefs(bad, "/repo"), /Invalid line range/);
  for (const bad of ["a.ts:1-3 and b.ts:5", "server.js lines 2-4", "a.ts (note) b.ts", "a.ts (x) b.ts (y)", "https://x.org/y", "agent://Scout", "(only a note)"])
    assert.throws(() => locatorRefs(bad, "/repo"), /must be a local path with optional line ranges/);
});
test("canonical URL strips tracking only, preserving meaningful parameters", () => {
  assert.equal(canonicalUrl("https://EXAMPLE.org/p?b=2&utm_source=x&a=1#part"), "https://example.org/p?a=1&b=2");
});
test("stable hash ignores object key order but not array order", () => {
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 })); assert.notEqual(hash([1, 2]), hash([2, 1]));
});
test("tokenizer respects quotes without evaluating shell expressions", () => {
  assert.deepEqual(tokenize('--mode web "hello world" $(whoami)'), ["--mode", "web", "hello world", "$(whoami)"]);
  assert.throws(() => tokenize('"unterminated'), /Unterminated/);
});
test("command parses explicit execution consent and budgets", () => {
  const c = parseCommand('--mode mixed --allow-exec --budget 3 --max-tools 10 --constraint "Do not install packages" Compare A and B', "test/main");
  assert.equal(c.op, "start"); if (c.op !== "start") return;
  assert.equal(c.config.allowExec, true); assert.equal(c.config.maxContinuations, 3); assert.equal(c.config.objective, "Compare A and B");
});
test("without --mode the command opens an intake instead of inferring a mode", () => {
  const c = parseCommand("--max-tools 5 --harness Inspect current releases");
  if (c.op !== "intake") throw new Error("Expected intake");
  assert.equal(c.draft, "Inspect current releases"); assert.equal(c.settings.maxToolCalls, 5); assert.equal(c.settings.allowHarness, true);
  assert.equal(parseCommand("start").op, "intake");
  assert.deepEqual(parseCommand(""), { op: "help" }); assert.deepEqual(parseCommand("resume"), { op: "resume" });
});
test("invalid flags and lifecycle arguments are rejected", () => {
  for (const c of ["--unknown 3 goal", "--budget", "--budget 20 goal", "--mode invalid goal", "status garbage", "--allow-exec --mode web goal", "--harness --mode web goal", "--mode web"])
    assert.throws(() => parseCommand(c));
});
test("double dash permits goal text beginning with flags or reserved words", () => {
  const c = parseCommand("start --mode web -- --strange status"); if (c.op !== "start") throw new Error("Expected start");
  assert.equal(c.config.objective, "--strange status");
});
test("intake permits only control tools", () => {
  for (const tool of ["ask", "todo", "deep_research"]) assert.equal(intakeBlockedReason(tool), undefined);
  for (const tool of ["read", "web_search", "task", "bash", "eval"]) assert.match(intakeBlockedReason(tool)!, /intake/);
});
test("read-only policy blocks product writes, interpreters, goal changes and unknown tools", () => {
  const l = new Ledger(); const m = l.start();
  for (const tool of ["write", "edit", "ast_edit", "bash", "eval", "goal", "lsp", "unknown_mcp"]) assert.ok(blockedReason(m, tool, {}, CWD));
  for (const tool of ["read", "web_search", "grep", "ast_grep", "todo", "think", "deep_research"]) assert.equal(blockedReason(m, tool, {}, CWD), undefined);
  assert.equal(blockedReason(m, "github", { op: "file_read" }, CWD), undefined);
  for (const op of ["pr_create", "pr_checkout", "pr_push", undefined]) assert.ok(blockedReason(m, "github", { op }, CWD));
  assert.ok(blockedReason(m, "write", { path: "autoresearch.sh" }, CWD)); assert.ok(blockedReason(m, "bash", { command: "bash autoresearch.sh" }, CWD));
});
test("execution is enabled only by explicit data/mixed consent", () => {
  const l = new Ledger(); const m = l.start({ mode: "mixed", allowExec: true });
  assert.equal(blockedReason(m, "eval", {}, CWD), undefined); assert.ok(blockedReason(m, "write", { path: "src/app.ts" }, CWD));
});
test("harness missions write only the root harness and run only it, synchronously", () => {
  const cwd = mkdtempSync(join(tmpdir(), "omp-harness-"));
  try {
    const m = new Ledger().start({ mode: "data", allowHarness: true });
    for (const path of ["autoresearch.sh", "./autoresearch.sh", join(cwd, "autoresearch.sh")]) assert.equal(blockedReason(m, "write", { path }, cwd), undefined);
    for (const command of ["bash autoresearch.sh", "sh ./autoresearch.sh", "  bash autoresearch.sh  "]) assert.equal(blockedReason(m, "bash", { command }, cwd), undefined);
    assert.equal(blockedReason(m, "bash", { command: "bash autoresearch.sh", cwd: "." }, cwd), undefined);
    for (const path of ["src/autoresearch.sh", "../autoresearch.sh", "package.json", "~/autoresearch.sh", "local://autoresearch.sh"]) assert.ok(blockedReason(m, "write", { path }, cwd));
    for (const input of [{ command: "bash autoresearch.sh; rm -rf src" }, { command: "bash autoresearch.sh && npm i" }, { command: "cd /tmp && bash autoresearch.sh" },
      { command: "bash autoresearch.sh", async: true }, { command: "bash autoresearch.sh", cwd: "/tmp" }, { command: "bash autoresearch.sh", name: "svc" }])
      assert.ok(blockedReason(m, "bash", input, cwd));
    for (const tool of ["eval", "edit"]) assert.ok(blockedReason(m, tool, { path: "autoresearch.sh" }, cwd));
    writeFileSync(join(cwd, "product.ts"), "x"); symlinkSync(join(cwd, "product.ts"), join(cwd, "autoresearch.sh"));
    assert.ok(blockedReason(m, "write", { path: "autoresearch.sh" }, cwd));
    rmSync(join(cwd, "autoresearch.sh")); linkSync(join(cwd, "product.ts"), join(cwd, "autoresearch.sh"));
    assert.ok(blockedReason(m, "write", { path: "autoresearch.sh" }, cwd));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test("data mode blocks parent web acquisition", () => {
  const l = new Ledger(); const m = l.start({ mode: "data" });
  assert.ok(blockedReason(m, "web_search", {}, CWD)); assert.ok(blockedReason(m, "read", { path: "https://example.org" }, CWD));
  assert.ok(blockedReason(m, "read", { path: "www.example.org" }, CWD)); assert.ok(blockedReason(m, "github", { op: "file_read" }, CWD));
  assert.ok(blockedReason(m, "grep", { path: "data.csv;https://example.org/x.json", pattern: "x" }, CWD));
  assert.equal(blockedReason(m, "read", { path: "data.csv" }, CWD), undefined); assert.equal(blockedReason(m, "grep", { path: "src;data", pattern: "x" }, CWD), undefined);
});
test("only explicit native scouts without custom tools can be delegated", () => {
  const l = new Ledger(); const m = l.start();
  assert.equal(blockedReason(m, "task", { tasks: [{ agent: "scout", task: "Inspect sources" }] }, CWD), undefined);
  for (const p of [{ task: "Code" }, { agent: "build" }, { agent: "scout", tools: [] }, { tasks: [{ agent: "scout" }, { agent: "build" }] }]) assert.ok(blockedReason(m, "task", p, CWD));
});
test("paused missions release the parent tool policy", () => {
  const l = new Ledger(); const m = l.start(); m.phase = "paused"; assert.equal(blockedReason(m, "write", {}, CWD), undefined);
});
