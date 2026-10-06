import test from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalUrl, hash, parseHarnessOutput } from "../src/validation.ts";
import { parseCommand, specConfig, tokenize } from "../src/command.ts";
import { DEFAULT_SETTINGS } from "../src/engine.ts";
import { blockedReason, intakeBlockedReason } from "../src/policy.ts";
import { buildReceipt } from "../src/receipts.ts";
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
test("task receipts record pinned or reported models and spawned agent ids", () => {
  const resolve = (s: string) => s === "critic" ? { provider: "test", id: "critic" } : undefined;
  const r = buildReceipt({ toolName: "task", toolCallId: "t1", isError: false,
    input: { context: "c", tasks: [{ agent: "scout", model: "critic" }, { agent: "scout", model: ["critic", "other"] }] },
    content: [{ type: "text", text: "Spawned 2 background agents using scout.\n- `Crit` (job `j1`)\n- `Crit-2` (job `j2`)" }] }, resolve);
  assert.deepEqual(r.models, ["test/critic"]); assert.deepEqual(r.agentIds, ["Crit", "Crit-2"]);
  const blocking = buildReceipt({ toolName: "task", toolCallId: "t2", isError: false, input: { agent: "scout" }, content: [{ type: "text", text: "done" }],
    details: { results: [{ id: "Rev", resolvedModel: "test/critic:high" }] } }, resolve);
  assert.deepEqual(blocking.models, ["test/critic"]); assert.deepEqual(blocking.agentIds, ["Rev"]);
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
