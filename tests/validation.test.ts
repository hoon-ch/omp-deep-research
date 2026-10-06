import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, hash, parseMetrics } from "../src/validation.ts";
import { parseCommand, tokenize } from "../src/command.ts";
import { blockedReason } from "../src/policy.ts";
import { Ledger } from "./helpers.ts";

test("parses finite metrics including exponent and negative values", () => {
  assert.deepEqual({ ...parseMetrics("METRIC score=1e-3\nMETRIC loss=-.5\nother output").metrics }, { score: .001, loss: -.5 });
});
test("malformed, duplicate, NaN and infinite metrics invalidate the result", () => {
  for (const s of ["METRIC score=NaN", "METRIC x=Infinity", "METRIC x=1e999", "METRIC x=1\nMETRIC x=2", "METRIC score=nope"])
    assert.ok(parseMetrics(s).error);
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
test("command defaults are visible and conservative", () => {
  const c = parseCommand("Inspect current releases"); if (c.op !== "start") throw new Error("Expected start");
  assert.equal(c.config.mode, "web"); assert.equal(c.config.allowExec, false);
  assert.deepEqual(parseCommand(""), { op: "help" }); assert.deepEqual(parseCommand("resume"), { op: "resume" });
});
test("invalid flags and lifecycle arguments are rejected", () => {
  for (const c of ["--unknown 3 goal", "--budget", "--budget 20 goal", "--mode invalid goal", "status garbage", "--allow-exec --mode web goal"])
    assert.throws(() => parseCommand(c));
});
test("double dash permits goal text beginning with flags or reserved words", () => {
  const c = parseCommand("start -- --strange status"); if (c.op !== "start") throw new Error("Expected start");
  assert.equal(c.config.objective, "--strange status");
});
test("read-only policy blocks product writes, interpreters, goal changes and unknown tools", () => {
  const l = new Ledger(); const m = l.start();
  for (const tool of ["write", "edit", "ast_edit", "bash", "eval", "goal", "lsp", "unknown_mcp"]) assert.ok(blockedReason(m, tool, {}));
  for (const tool of ["read", "web_search", "grep", "ast_grep", "todo", "think", "deep_research"]) assert.equal(blockedReason(m, tool, {}), undefined);
  assert.equal(blockedReason(m, "github", { op: "file_read" }), undefined);
  for (const op of ["pr_create", "pr_checkout", "pr_push", undefined]) assert.ok(blockedReason(m, "github", { op }));
});
test("execution is enabled only by explicit data/mixed consent", () => {
  const l = new Ledger(); const m = l.start({ mode: "mixed", allowExec: true });
  assert.equal(blockedReason(m, "eval", {}), undefined); assert.ok(blockedReason(m, "write", {}));
});
test("data mode blocks parent web acquisition", () => {
  const l = new Ledger(); const m = l.start({ mode: "data" });
  assert.ok(blockedReason(m, "web_search", {})); assert.ok(blockedReason(m, "read", { path: "https://example.org" }));
  assert.ok(blockedReason(m, "read", { path: "www.example.org" })); assert.ok(blockedReason(m, "github", { op: "file_read" }));
  assert.equal(blockedReason(m, "read", { path: "data.csv" }), undefined);
});
test("only explicit native scouts without custom tools can be delegated", () => {
  const l = new Ledger(); const m = l.start();
  assert.equal(blockedReason(m, "task", { tasks: [{ agent: "scout", task: "Inspect sources" }] }), undefined);
  for (const p of [{ task: "Code" }, { agent: "build" }, { agent: "scout", tools: [] }, { tasks: [{ agent: "scout" }, { agent: "build" }] }]) assert.ok(blockedReason(m, "task", p));
});
test("paused missions release the parent tool policy", () => {
  const l = new Ledger(); const m = l.start(); m.phase = "paused"; assert.equal(blockedReason(m, "write", {}), undefined);
});
