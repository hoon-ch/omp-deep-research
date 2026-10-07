import test from "node:test";
import assert from "node:assert/strict";
import { budgetReason, DEFAULT_SETTINGS, ENTRY_TYPE, evidenceDigest, executionEvent, intakeEvent, lifecycleEvent, makeEvent, modeEvent, prepareOperation, resetEvent, restore, startEvent } from "../src/engine.ts";
import { CRITIC_INSTRUCTIONS } from "../src/briefs.ts";
import { buildReceipt, snapshotHash } from "../src/receipts.ts";
import { bestRun, effectToNoise } from "../src/runs.ts";
import type { ToolResult } from "../src/host.ts";
import { Ledger, NOW, VERDICT } from "./helpers.ts";

test("creates an explicit bounded mission", () => {
  const l = new Ledger(); const m = l.start();
  assert.equal(m.phase, "active"); assert.equal(m.mode, "web"); assert.equal(m.allowExec, false);
  assert.equal(m.pass.deadlineAt, "2026-10-06T00:20:00.000Z");
});
test("rejects invalid or unsafe config", () => {
  for (const override of [{ mode: "invalid" }, { mode: undefined }, { allowExec: true }, { allowHarness: true }, { maxContinuations: 9 }, { maxToolCalls: 0 }, { maxMinutes: NaN }]) {
    const l = new Ledger(); assert.throws(() => l.start(override as never));
  }
});
test("does not replace active or paused missions", () => {
  const l = new Ledger(); l.start(); assert.throws(() => l.start(), /open mission/);
  l.add(lifecycleEvent(l.state(), "pause", NOW)); assert.throws(() => l.start(), /open mission/);
});
test("permission changes replay without losing work, resetting budgets or resuming a paused pass", () => {
  const l = new Ledger(); l.start({ mode: "mixed" }); l.evidence();
  l.add(makeEvent(l.state().mission!.id, "tool_counted", { toolCallId: "read-1" }, NOW));
  l.add(makeEvent(l.state().mission!.id, "usage_recorded", { tokens: 1234, cost: 0.02 }, NOW));
  l.op({ op: "notes", notes: "Experiment still needs consent" });
  l.add(lifecycleEvent(l.state(), "pause", NOW));
  const before = l.state().mission!; const branch = [...l.entries];
  for (const permission of ["harness", "exec", "harness", "deny"] as const) {
    const event = executionEvent(l.state(), permission, NOW);
    assert.deepEqual((event.data as { previous: unknown }).previous, { allowHarness: l.state().mission!.allowHarness, allowExec: l.state().mission!.allowExec });
    l.add(event);
    assert.deepEqual(l.state().mission, { ...before, allowHarness: permission === "harness", allowExec: permission === "exec" });
  }
  assert.deepEqual(restore(branch).mission, before);
  l.add(lifecycleEvent(l.state(), "resume", NOW));
  assert.equal(l.state().mission!.allowHarness, false); assert.equal(l.state().mission!.allowExec, false);
});
test("permission grants require an open data/mixed mission and cannot be issued through the agent tool", () => {
  const l = new Ledger();
  assert.throws(() => executionEvent(l.state(), "exec", NOW), /No mission/);
  l.add(intakeEvent(l.state(), "goal", DEFAULT_SETTINGS, NOW));
  assert.throws(() => executionEvent(l.state(), "harness", NOW), /Intake/);
  l.op({ op: "start", mission: { objective: "goal", mode: "web", constraints: [], deliverables: [], allowExec: true, allowHarness: true } });
  assert.equal(l.state().mission!.allowExec, false); assert.equal(l.state().mission!.allowHarness, false);
  assert.throws(() => executionEvent(l.state(), "exec", NOW), /data\/mixed/);
  assert.throws(() => executionEvent(l.state(), "harness", NOW), /data\/mixed/);
  for (const op of ["allow", "deny", "execution_set"])
    assert.throws(() => l.op({ op, permission: "exec" }), /op must be/);
  l.add(modeEvent(l.state(), "mixed", NOW)); l.add(executionEvent(l.state(), "exec", NOW));
  assert.throws(() => modeEvent(l.state(), "web", NOW), /only supported/);
  l.add(executionEvent(l.state(), "deny", NOW)); l.add(modeEvent(l.state(), "web", NOW));
  l.evidence(); l.op({ op: "verdict", verdict: VERDICT });
  assert.throws(() => executionEvent(l.state(), "deny", NOW), /only an open mission/);
  const cancelled = new Ledger(); cancelled.start({ mode: "data" });
  cancelled.add(lifecycleEvent(cancelled.state(), "cancel", NOW));
  assert.throws(() => executionEvent(cancelled.state(), "harness", NOW), /only an open mission/);
});
test("invalid execution events fail closed during replay", () => {
  for (const permission of ["unknown", "exec"]) {
    const l = new Ledger(); l.start();
    l.add(makeEvent(l.state().mission!.id, "execution_set", { permission }, NOW));
    assert.throws(() => l.state(), /permission must be|data\/mixed/);
  }
});
test("replays only custom entries in the selected branch", () => {
  const l = new Ledger(); l.start(); const branch = [...l.entries]; l.evidence();
  assert.equal(restore(branch).mission!.evidence.length, 0);
  assert.equal(l.state().mission!.evidence.length, 1);
  assert.equal(restore([{ type: "custom", customType: "unrelated", data: {} }]).mission, undefined);
});
test("duplicate event ids are replayed once", () => {
  const l = new Ledger(); l.start(); l.evidence(); const last = l.entries.at(-1)!;
  l.entries.push(last); assert.equal(l.state().mission!.evidence.length, 1);
});
test("unknown ledger versions and malformed events fail closed", () => {
  assert.throws(() => restore([{ type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 2 } }]), /Unsupported/);
  assert.throws(() => restore([{ type: "custom", customType: ENTRY_TYPE, data: null }]), /object/);
});
test("cross-mission reordered events fail closed", () => {
  const l = new Ledger(); l.start(); l.add(makeEvent("wrong-mission", "notes_updated", { notes: "wrong" }, NOW));
  assert.throws(() => l.state(), /ordering/);
});
test("evidence requires an observed source receipt", () => {
  const l = new Ledger(); l.start(); assert.throws(() => l.evidence({ receiptId: "invented" }), /Unknown source receipt/);
});
test("deduplicates the same canonical source and normalized claim", () => {
  const l = new Ledger(); l.start(); l.evidence({ locator: "https://example.org/paper?utm_source=x#section" });
  const result = l.evidence({ claim: "Approach   A supports X" }) as { duplicate: boolean };
  assert.equal(result.duplicate, true); assert.equal(l.state().mission!.evidence.length, 1);
});
test("opposing stances are retained rather than deduplicated", () => {
  const l = new Ledger(); l.start(); l.evidence(); l.evidence({ stance: "contradicts" });
  assert.equal(l.state().mission!.evidence.length, 2);
});
test("mode gates reject mismatched evidence", () => {
  const web = new Ledger(); web.start(); assert.throws(() => web.evidence({ source: "file" }), /not allowed/);
  const data = new Ledger(); data.start({ mode: "data" }); assert.throws(() => data.evidence(), /not allowed/);
});
test("a failed fetch cannot support source contents", () => {
  const l = new Ledger(); l.start(); const r = l.receipt({ isError: true });
  assert.throws(() => l.evidence({ receiptId: r.id }), /failed fetch/);
});
test("failed experiments can be recorded as failure evidence", () => {
  const l = new Ledger(); l.start({ mode: "mixed" }); const r = l.receipt({ tool: "bash", isError: true });
  l.evidence({ source: "experiment", locator: "local://run-output", receiptId: r.id });
  assert.equal(l.state().mission!.evidence.length, 1);
});
test("file evidence must come from reading the cited files, never from a scout report", () => {
  const l = new Ledger(); l.start({ mode: "data" });
  const file = (receipt: { id: string }, locator: string) => l.op({ op: "evidence", evidence: { source: "file", title: "t", claim: `c ${locator}`, summary: "s", locator, receiptId: receipt.id, stance: "supports" } });
  const scout = l.receipt({ tool: "read", files: [], opened: ["agent://FirmwareWakePipeline"] });
  assert.throws(() => file(scout, "firmware/audio_i2s.c:1429-1444"), /scout reports/);
  assert.throws(() => file(l.receipt({ tool: "task" }), "firmware/audio_i2s.c"), /scout reports/);
  const log = l.receipt({ tool: "read", files: [{ path: "/repo/docs/validation-log.md", lines: [[125, 190]] }] });
  assert.throws(() => file(log, "bridge/session_fsm.py:780-829"), /returned no content of \/repo\/bridge\/session_fsm\.py/);
  file(log, "docs/validation-log.md:130-133");
  const grep = l.receipt({ tool: "grep", files: [{ path: "/repo/firmware/main/wake.cc", lines: [[7, 12], [88, 88]] }, { path: "/repo/firmware/main/nvs_cfg.c", lines: [[4, 4]] }] });
  file(grep, "firmware/main/wake.cc:8-11,88; firmware/main/nvs_cfg.c:4");
  assert.throws(() => file(grep, "firmware/main/wake.cc:8; bridge/x.py:2"), /bridge\/x\.py/);
  assert.equal(l.state().mission!.evidence.length, 2);
  assert.throws(() => l.op({ op: "evidence", evidence: { source: "experiment", title: "t", claim: "c", summary: "s", locator: "run", receiptId: scout.id, stance: "context" } }), /Experiment evidence/);
});
test("file evidence cites only lines the receipt showed; a bare file needs the whole file", () => {
  const l = new Ledger(); l.start({ mode: "data" });
  const file = (receipt: { id: string }, locator: string) => l.op({ op: "evidence", evidence: { source: "file", title: "t", claim: `c ${locator}`, summary: "s", locator, receiptId: receipt.id, stance: "supports" } });
  const partial = l.receipt({ tool: "read", files: [{ path: "/repo/a.ts", lines: [[1, 50], [80, 90]] }] });
  assert.throws(() => file(partial, "a.ts"), /did not show all of \/repo\/a\.ts \(it showed only lines 1-50,80-90\)/);
  assert.throws(() => file(partial, "a.ts:45-60"), /did not show \/repo\/a\.ts:45-60/);
  assert.throws(() => file(partial, "a.ts:10,55"), /did not show \/repo\/a\.ts:55-55/);
  file(partial, "a.ts:10-20,85"); file(partial, "a.ts#L40-L50");
  assert.throws(() => file(l.receipt({ tool: "read", files: [{ path: "/repo/b.ts" }] }), "b.ts:3"), /host did not report which lines/);
  const whole = l.receipt({ tool: "read", files: [{ path: "/repo/c.ts", lines: [[1, 9]], complete: true }] });
  file(whole, "c.ts"); file(whole, "c.ts:2-4");
  assert.throws(() => file(whole, "c.ts:9-5"), /Invalid line range/);
});
test("listing evidence records existence from a glob/find listing, never with line ranges", () => {
  const l = new Ledger(); l.start({ mode: "data" });
  const listing = (receipt: { id: string }, locator: string) => l.op({ op: "evidence", evidence: { source: "listing", title: "t", claim: `exists ${locator}`, summary: "s", locator, receiptId: receipt.id, stance: "context" } });
  const glob = l.receipt({ tool: "glob", listed: ["/repo/tests/a.test.ts", "/repo/tests/fixtures"] });
  listing(glob, "tests/a.test.ts; tests/fixtures/");
  listing(glob, "tests/, tests/fixtures");
  assert.throws(() => listing(glob, "tests/b.test.ts"), /did not list \/repo\/tests\/b\.test\.ts/);
  assert.throws(() => listing(glob, "test"), /did not list \/repo\/test$/);
  assert.throws(() => listing(glob, "tests/a.test.ts:3"), /paths only/);
  assert.throws(() => listing(l.receipt({ tool: "web_search" }), "tests/a.test.ts"), /glob\/find receipt/);
  listing(l.receipt({ tool: "grep", files: [{ path: "/repo/src/x.ts", lines: [[3, 3]] }] }), "src/x.ts");
  const web = new Ledger(); web.start();
  assert.throws(() => web.op({ op: "evidence", evidence: { source: "listing", title: "t", claim: "c", summary: "s", locator: "a.ts", receiptId: web.receipt({ tool: "glob", listed: ["/repo/a.ts"] }).id, stance: "context" } }), /not allowed in web mode/);
});
test("rejects javascript URLs and embedded credentials", () => {
  for (const locator of ["javascript:alert(1)", "https://user:password@example.org/"]) {
    const l = new Ledger(); l.start(); assert.throws(() => l.evidence({ locator }), /HTTP/);
  }
});
test("request ids make writes idempotent", () => {
  const l = new Ledger(); l.start(); const input = { op: "notes", notes: "Test next hypothesis", requestId: "stable-key" };
  l.op(input); const count = l.entries.length; const r = l.op(input) as { duplicate: boolean };
  assert.equal(r.duplicate, true); assert.equal(l.entries.length, count);
  assert.throws(() => l.op({ ...input, notes: "Different" }), /different input/);
});
test("conclusive verdict requires evidence-linked findings", () => {
  const l = new Ledger(); l.start(); assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /Unknown evidence/);
  l.evidence(); assert.throws(() => l.op({ op: "verdict", verdict: { ...VERDICT, findings: [] } }), /cited findings/);
  assert.throws(() => l.op({ op: "verdict", verdict: { ...VERDICT, findings: [{ claim: "x", evidenceIds: [] }] } }), /at least one/);
});
test("verdict replay remains idempotent after mission completion", () => {
  const l = new Ledger(); l.start(); l.evidence();
  const input = { op: "verdict", requestId: "final-v1", verdict: VERDICT };
  l.op(input); assert.equal(l.state().mission!.phase, "completed");
  assert.equal((l.op(input) as { duplicate: boolean }).duplicate, true);
  assert.equal(l.state().mission!.verdicts.length, 1);
  assert.throws(() => l.op({ op: "notes", notes: "post-completion" }), /completed/);
});
test("inconclusive needs caveats and remains resumable", () => {
  const l = new Ledger(); l.start();
  const verdict = { disposition: "inconclusive", confidence: "low", summary: "No accessible evidence", findings: [], caveats: [] as string[] };
  assert.throws(() => l.op({ op: "verdict", verdict }), /limitations/);
  l.op({ op: "verdict", verdict: { ...verdict, caveats: ["Source access unavailable"] } });
  const oldPass = l.state().mission!.pass.id;
  assert.equal(l.state().mission!.phase, "paused");
  l.add(lifecycleEvent(l.state(), "resume", NOW));
  assert.equal(l.state().mission!.phase, "active"); assert.notEqual(l.state().mission!.pass.id, oldPass);
  assert.equal(l.state().mission!.verdicts.length, 1);
});
test("clear retires current mission without deleting ledger", () => {
  const l = new Ledger(); l.start(); l.evidence(); const count = l.entries.length;
  l.add(lifecycleEvent(l.state(), "clear", NOW));
  assert.equal(l.state().mission, undefined); assert.equal(l.entries.length, count + 1);
  l.start(); assert.equal(l.state().mission!.evidence.length, 0);
});
test("completed missions can be replaced, not resumed or cancelled", () => {
  const l = new Ledger(); l.start(); l.evidence(); l.op({ op: "verdict", verdict: VERDICT });
  assert.throws(() => l.add(lifecycleEvent(l.state(), "resume", NOW)), /paused/);
  assert.throws(() => l.add(lifecycleEvent(l.state(), "cancel", NOW)), /completed/);
  l.start(); assert.equal(l.state().mission!.phase, "active");
});
test("strict run classification uses observed metrics rather than model-supplied scores", () => {
  const l = new Ledger(); l.start({ mode: "data" });
  const run = (value: number, overrides = {}) => {
    const r = l.receipt({ tool: "bash", metrics: { latency_ms: value }, ...overrides });
    l.op({ op: "run", run: { label: "Benchmark", hypothesis: "Lower latency", receiptId: r.id, primaryMetric: "latency_ms", direction: "lower" } });
  };
  run(100); run(90); run(95); run(90); run(0, { isError: true }); run(0, { metricError: "invalid" });
  assert.deepEqual(l.state().mission!.runs.map(r => r.outcome), ["baseline", "keep", "discard", "discard", "crash", "checks_failed"]);
  assert.equal(bestRun(l.state().mission!)!.id, "R2");
});
test("flagging invalid runs recomputes best and later comparisons", () => {
  const l = new Ledger(); l.start({ mode: "mixed" });
  for (const value of [100, 1]) {
    const r = l.receipt({ metrics: { score: value } });
    l.op({ op: "run", run: { label: "Bench", hypothesis: "Compare", receiptId: r.id, primaryMetric: "score", direction: "lower" } });
  }
  l.op({ op: "flag_run", runId: "R2", reason: "Workload was incomplete" });
  assert.equal(bestRun(l.state().mission!)!.id, "R1");
  const r = l.receipt({ metrics: { score: 80 } });
  l.op({ op: "run", run: { label: "Bench", hypothesis: "Compare", receiptId: r.id, primaryMetric: "score", direction: "lower" } });
  assert.equal(l.state().mission!.runs.at(-1)!.outcome, "keep");
});
test("the metric contract is fixed within a segment and can change only in a new segment", () => {
  const l = new Ledger(); l.start({ mode: "data" }); const r = l.receipt({ metrics: { score: 3, ms: 9 } });
  const run = { label: "x", hypothesis: "x", receiptId: r.id, primaryMetric: "score", direction: "higher" };
  l.op({ op: "run", run }); assert.throws(() => l.op({ op: "run", run: { ...run, receiptId: l.receipt({ metrics: { score: 1 } }).id, direction: "lower" } }), /new segment/);
  l.op({ op: "segment", segment: { reason: "Switched to latency workload", metric: { name: "ms", direction: "lower" } } });
  const r2 = l.receipt({ metrics: { ms: 9 } });
  l.op({ op: "run", run: { label: "y", hypothesis: "y", receiptId: r2.id } });
  const m = l.state().mission!;
  assert.deepEqual(m.runs.map(x => [x.segment, x.primaryMetric, x.outcome]), [[0, "score", "baseline"], [1, "ms", "baseline"]]);
  assert.equal(bestRun(m)!.id, "R2"); assert.equal(bestRun(m, 0)!.id, "R1");
});
test("a declared metric is enforced from the first run", () => {
  const l = new Ledger(); l.start({ mode: "data", metric: { name: "ms", direction: "lower" } });
  assert.throws(() => l.op({ op: "run", run: { label: "x", hypothesis: "x", receiptId: l.receipt({ metrics: { score: 1 } }).id, primaryMetric: "score", direction: "higher" } }), /measures ms/);
  l.op({ op: "run", run: { label: "x", hypothesis: "x", receiptId: l.receipt({ metrics: { ms: 5 }, asi: { cache: "warm" } }).id } });
  const run = l.state().mission!.runs[0]!;
  assert.equal(run.outcome, "baseline"); assert.deepEqual(run.asi, { cache: "warm" });
});
test("effect-to-noise needs three valid runs with spread and ignores flagged runs", () => {
  const l = new Ledger(); l.start({ mode: "data", metric: { name: "ms", direction: "lower" } });
  const run = (ms: number) => l.op({ op: "run", run: { label: "x", hypothesis: "x", receiptId: l.receipt({ metrics: { ms } }).id } });
  run(100); run(90); assert.equal(effectToNoise(l.state().mission!), null);
  run(80); // values 100, 90, 80: median 90, MAD 10, |80 - 100| / 10 = 2
  assert.equal(effectToNoise(l.state().mission!), 2);
  l.op({ op: "flag_run", runId: "R3", reason: "Cache was warm" }); assert.equal(effectToNoise(l.state().mission!), null);
});
test("configured critic must be host-attested and answer for the current complete evidence snapshot", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence();
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /critic receipt/);
  const unpinned = l.receipt({ tool: "task", agents: [{ id: "Crit" }] });
  const response = l.receipt({ tool: "read", opened: ["agent://Crit"], review: l.review() });
  const base = { evaluator: "test/critic", receiptId: response.id };
  assert.throws(() => l.op({ op: "critic", critic: base }), /spawnReceiptId/);
  assert.throws(() => l.op({ op: "critic", critic: { ...base, spawnReceiptId: unpinned.id } }), /Crit ran an unpinned model, not test\/critic/);
  const fallback = l.receipt({ tool: "task", agents: [{ id: "Crit", requestedModel: "test/critic", fallback: true }] });
  assert.throws(() => l.op({ op: "critic", critic: { ...base, spawnReceiptId: fallback.id } }), /fallback/);
  const handed = () => l.criticSpawn();
  const spawn = handed();
  const stranger = l.receipt({ tool: "read", opened: ["agent://Other"], review: l.review() });
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: stranger.id, spawnReceiptId: spawn.id } }), /read of agent:\/\/<id>/);
  const unstructured = l.receipt({ tool: "read", opened: ["agent://Crit"] });
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: unstructured.id, spawnReceiptId: spawn.id } }), /no structured critic answer/);
  const partial = l.receipt({ tool: "read", opened: ["agent://Crit"], review: l.review({ evidenceIds: [] }) });
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: partial.id, spawnReceiptId: spawn.id } }), /complete current evidence/);
  const critic = { ...base, spawnReceiptId: spawn.id };
  l.op({ op: "critic", critic });
  assert.equal(l.state().mission!.critics[0]!.agentId, "Crit");
  l.evidence({ claim: "New evidence" });
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  const fresh = l.receipt({ tool: "read", opened: ["agent://Crit"], review: l.review() });
  assert.throws(() => l.op({ op: "critic", critic: { ...critic, receiptId: fresh.id } }), /did not carry the current view:"critic" snapshot/);
  l.op({ op: "critic", critic: { ...critic, receiptId: fresh.id, spawnReceiptId: handed().id } });
  l.op({ op: "verdict", verdict: VERDICT }); assert.equal(l.state().mission!.phase, "completed");
});
test("a past critic answer cannot be re-recorded as a review of a newer snapshot", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence();
  const spawn = l.criticSpawn();
  const old = l.receipt({ tool: "read", opened: ["agent://Crit"], review: l.review() });
  l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: old.id, spawnReceiptId: spawn.id } });
  l.evidence({ claim: "Later evidence" });
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: old.id, spawnReceiptId: spawn.id } }), /different evidence\/run snapshot/);
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
});
// Review regressions: host-shaped tool results go through buildReceipt, so these pin the receipt → evidence/critic contract.
const hostReceipt = (l: Ledger, event: Omit<ToolResult, "isError" | "toolCallId">, resolve = (s: string) => /^test\/\w+$/.test(s) ? { provider: "test", id: s.slice(5) } : undefined) =>
  l.receipt(buildReceipt({ ...event, toolCallId: `host-${++l.serial}`, isError: false }, resolve, "/repo", NOW));
test("R1: a link inside a page is not a read of the linked page; a host-observed redirect is", () => {
  const l = new Ledger(); l.start();
  const page = hostReceipt(l, { toolName: "read", input: { path: "https://a.example/doc" }, details: { kind: "url", url: "https://a.example/doc", finalUrl: "https://a.example/doc/v2" },
    content: [{ type: "text", text: "URL: https://a.example/doc/v2\n\nSee https://b.example/paper for details" }] });
  assert.throws(() => l.evidence({ locator: "https://b.example/paper", receiptId: page.id }), /did not open that URL/);
  l.evidence({ locator: "https://a.example/doc/v2", receiptId: page.id }); l.evidence({ locator: "https://a.example/doc", receiptId: page.id, claim: "Other" });
  assert.equal(l.state().mission!.evidence.length, 2);
});
test("R2: a search scope without returned matches backs no file evidence", () => {
  const l = new Ledger(); l.start({ mode: "data" });
  const file = (receiptId: string, locator: string) => l.op({ op: "evidence", evidence: { source: "file", title: "t", claim: `c ${locator}`, summary: "s", locator, receiptId, stance: "supports" } });
  const miss = hostReceipt(l, { toolName: "grep", input: { path: "src", pattern: "NO_SUCH_MATCH" }, details: { cwd: "/repo", files: [], matchCount: 0 }, content: [{ type: "text", text: "No matches found" }] });
  assert.throws(() => file(miss.id, "src/unread.ts:10-20"), /returned matches/);
  const hit = hostReceipt(l, { toolName: "grep", input: { path: "src", pattern: "x" }, details: { cwd: "/repo", files: ["src/a.ts"], matchCount: 1, displayContent: "# src/\n## a.ts#1A2B\n 2│ctx\n*3│x" }, content: [{ type: "text", text: "# src/a.ts\n3:x" }] });
  assert.throws(() => file(hit.id, "src/unread.ts:10-20"), /returned no content of \/repo\/src\/unread\.ts/);
  file(hit.id, "src/a.ts:2-3");
  assert.throws(() => file(hit.id, "src/a.ts:3-9"), /did not show \/repo\/src\/a\.ts:3-9 \(it showed only lines 2-3\)/);
  assert.throws(() => file(hit.id, "src/a.ts"), /did not show all of/);
  const dir = hostReceipt(l, { toolName: "read", input: { path: "src" }, details: { resolvedPath: "/repo/src", isDirectory: true }, content: [{ type: "text", text: "a.ts\nunread.ts" }] });
  assert.throws(() => file(dir.id, "src/unread.ts"), /returned matches/);
  const listed = hostReceipt(l, { toolName: "glob", input: { path: "src/*.ts" }, details: { files: ["src/unread.ts"] }, content: [{ type: "text", text: "src/unread.ts" }] });
  assert.throws(() => file(listed.id, "src/unread.ts"), /glob\/find file lists/);
});
test("R3: another batch agent's answer cannot pass as the pinned critic's", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence();
  const spawn = hostReceipt(l, { toolName: "task", input: { context: l.brief(), tasks: [{ name: "Critic", agent: "scout", model: "test/critic" }, { name: "Helper", agent: "scout", model: "test/helper" }] },
    details: { results: [], progress: [{ index: 0, id: "Critic" }, { index: 1, id: "Helper" }] }, content: [{ type: "text", text: "Spawned 2 agents" }] });
  const answer = (id: string) => hostReceipt(l, { toolName: "read", input: { path: `agent://${id}` }, details: { resolvedPath: `/tmp/${id}.md` }, content: [{ type: "text", text: JSON.stringify(l.review()) }] });
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: answer("Helper").id, spawnReceiptId: spawn.id } }), /Helper ran test\/helper, not test\/critic/);
  l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: answer("Critic").id, spawnReceiptId: spawn.id } });
  l.op({ op: "verdict", verdict: VERDICT }); assert.equal(l.state().mission!.phase, "completed");
});
test("R3: a blocking batch result is attributed to the agent whose model actually ran", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence();
  const batch = (answering: number) => hostReceipt(l, { toolName: "task", input: { context: l.brief(), tasks: [{ agent: "scout", model: "test/critic" }, { agent: "scout", model: "test/helper" }] },
    details: { results: [{ index: 0, id: "Critic", resolvedModel: "test/critic" }, { index: 1, id: "Helper", resolvedModel: "test/helper" }]
      .map(r => r.index === answering ? { ...r, structuredOutput: l.review() } : r) }, content: [{ type: "text", text: "done" }] });
  const helperAnswered = batch(1);
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: helperAnswered.id, spawnReceiptId: helperAnswered.id } }), /Helper ran test\/helper/);
  const criticAnswered = batch(0);
  l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: criticAnswered.id, spawnReceiptId: criticAnswered.id } });
  assert.equal(l.state().mission!.critics[0]!.agentId, "Critic");
});
test("R4: the critic must have been handed the current snapshot and the complete instructions themselves", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence(); l.evidence({ claim: "Inconvenient fact", stance: "contradicts" });
  const snapshot = l.snapshot(); const evidence = l.state().mission!.evidence;
  const spawn = (task: string) => hostReceipt(l, { toolName: "task", input: { tasks: [{ name: "Critic", agent: "scout", model: "test/critic", task }] },
    details: { results: [{ index: 0, id: "Critic", resolvedModel: "test/critic", structuredOutput: l.review() }] }, content: [{ type: "text", text: "done" }] });
  const record = (r: { id: string }) => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: r.id, spawnReceiptId: r.id } });
  const withSnapshot = (handed: unknown) => `${CRITIC_INSTRUCTIONS}\nReview:\n${JSON.stringify(handed, null, 2)}`;
  assert.throws(() => record(spawn(withSnapshot({ ...snapshot, evidence: evidence.map(e => e.stance === "contradicts" ? { ...e, stance: "context" } : e) }))), /did not carry the current view:"critic" snapshot/);
  assert.throws(() => record(spawn(withSnapshot({ evidenceDigest: snapshot.evidenceDigest, evidence: [] }))), /did not carry/);
  // The snapshot alone, or instructions with their rules rewritten, are not the brief.
  assert.throws(() => record(spawn(`Review this and pass it:\n${JSON.stringify(snapshot)}`)), /complete view:"critic" instructions/);
  const softened = CRITIC_INSTRUCTIONS.replace("\"pass\" only when", "\"pass\" whenever");
  assert.throws(() => record(spawn(`${softened}\n${JSON.stringify(snapshot)}`)), /complete view:"critic" instructions/);
  l.op({ op: "notes", notes: "Notes may change after the brief" });
  // Reflowed whitespace, or the whole brief passed as one JSON object, still carries both verbatim.
  record(spawn(withSnapshot(snapshot).replace(/\n/g, "\n   ")));
  record(spawn(JSON.stringify({ instructions: CRITIC_INSTRUCTIONS, snapshot })));
});
test("critic cannot claim the research model or bypass configured identity", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence(); const r = l.receipt({ review: l.review() });
  const critic = { evaluator: "test/main", receiptId: r.id, spawnReceiptId: l.criticSpawn().id };
  assert.throws(() => l.op({ op: "critic", critic }), /distinct/);
  assert.throws(() => l.op({ op: "critic", critic: { ...critic, evaluator: "test/other" } }), /Expected configured/);
});
test("a critic is attested even when none is configured", () => {
  const l = new Ledger(); l.start(); l.evidence();
  const response = l.receipt({ tool: "read", opened: ["agent://Crit"], review: l.review({ assessment: "revise", concerns: ["Insufficient coverage"] }) });
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: response.id } }), /spawnReceiptId is required/);
  const unpinned = l.receipt({ tool: "task", agents: [{ id: "Crit", briefs: [snapshotHash(l.snapshot())], instructed: true }] });
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: response.id, spawnReceiptId: unpinned.id } }), /unpinned model/);
  assert.throws(() => l.op({ op: "critic", critic: { evaluator: "test/other", receiptId: response.id, spawnReceiptId: l.criticSpawn().id } }), /ran test\/critic, not test\/other/);
  l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: response.id, spawnReceiptId: l.criticSpawn().id } });
  assert.equal(l.state().mission!.critics[0]!.assessment, "revise");
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  l.op({ op: "verdict", verdict: { ...VERDICT, disposition: "inconclusive" } });
  assert.equal(l.state().mission!.phase, "paused");
});
test("source receipts are paginated newest-first", () => {
  const l = new Ledger(); l.start(); for (let i = 0; i < 15; i++) l.receipt();
  const p = l.op({ op: "read", view: "receipts" }) as { receipts: unknown[]; nextOffset: number; total: number };
  assert.equal(p.receipts.length, 12); assert.equal(p.nextOffset, 12); assert.equal(p.total, 15);
});
test("budgets stop new acquisition but do not erase state", () => {
  const l = new Ledger(); l.start({ maxToolCalls: 1, maxTokens: 5000, maxCost: 0.5 });
  assert.equal(budgetReason(l.state().mission!, Date.parse(NOW)), undefined);
  l.add(makeEvent(l.state().mission!.id, "usage_recorded", { tokens: 4000, cost: 0.6 }, NOW));
  assert.match(budgetReason(l.state().mission!, Date.parse(NOW))!, /cost budget/);
  l.add(makeEvent(l.state().mission!.id, "usage_recorded", { tokens: 1000, cost: 0 }, NOW));
  assert.match(budgetReason(l.state().mission!, Date.parse(NOW))!, /token budget/);
  l.add(makeEvent(l.state().mission!.id, "tool_counted", { toolCallId: "x" }, NOW));
  assert.match(budgetReason(l.state().mission!, Date.parse(NOW))!, /tool budget/);
  assert.match(budgetReason(l.state().mission!, Date.parse(NOW) + 21 * 60_000)!, /wall-clock/);
  l.add(lifecycleEvent(l.state(), "pause", NOW)); l.add(lifecycleEvent(l.state(), "resume", NOW));
  assert.equal(budgetReason(l.state().mission!, Date.parse(NOW)), undefined);
});
test("a conclusive verdict must confront contradicting evidence", () => {
  const l = new Ledger(); l.start(); l.evidence(); l.evidence({ claim: "B outperforms A", stance: "contradicts" });
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /Contradicting evidence E2/);
  assert.throws(() => l.op({ op: "verdict", verdict: { ...VERDICT, caveats: ["E22 is unrelated"] } }), /E2/);
  l.op({ op: "verdict", verdict: { ...VERDICT, caveats: ["E2 measured a different workload"] } });
  assert.equal(l.state().mission!.phase, "completed");
});
test("mode changes are operator events that keep evidence and respect execution consent", () => {
  const l = new Ledger(); l.start({ mode: "mixed", allowHarness: true }); l.evidence();
  assert.throws(() => modeEvent(l.state(), "web", NOW), /only supported in data\/mixed/);
  assert.throws(() => modeEvent(l.state(), "mixed", NOW), /already/);
  l.add(modeEvent(l.state(), "data", NOW));
  const m = l.state().mission!; assert.equal(m.mode, "data"); assert.equal(m.evidence.length, 1);
  assert.throws(() => l.evidence({ claim: "Another web fact" }), /not allowed in data mode/);
});
test("ledger reset retires unreadable history without deleting it", () => {
  const l = new Ledger(); l.start(); l.entries.push({ type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 99 } });
  assert.throws(() => l.state(), /Unsupported/);
  l.add(resetEvent("operator", NOW)); assert.equal(l.state().mission, undefined);
  assert.equal(l.start().phase, "active");
});
test("digest changes with evidence, not unrelated source acquisition", () => {
  const l = new Ledger(); l.start(); l.evidence(); const d = evidenceDigest(l.state().mission!);
  l.receipt(); assert.equal(evidenceDigest(l.state().mission!), d);
  l.evidence({ claim: "Another fact" }); assert.notEqual(evidenceDigest(l.state().mission!), d);
});

test("search snippets cannot substitute for an opened web source", () => {
  const l = new Ledger(); l.start(); const r = l.receipt({ tool: "web_search" });
  assert.throws(() => l.evidence({ receiptId: r.id }), /Open the original/);
});
test("a real receipt cannot be used to invent an unrelated web locator", () => {
  const l = new Ledger(); l.start();
  assert.throws(() => l.evidence({ locator: "https://unobserved.example.org/fiction" }), /did not open that URL/);
});

const MISSION = { objective: "Which approach is faster on our workload?", mode: "data", constraints: ["Use the existing benchmark only"], deliverables: ["Ranked comparison"] };
test("intake creates no mission; start applies operator settings the tool cannot change", () => {
  const l = new Ledger();
  l.add(intakeEvent(l.state(), "compare approaches", { ...structuredClone(DEFAULT_SETTINGS), maxToolCalls: 7, allowHarness: true }, NOW));
  assert.equal(l.state().mission, undefined); assert.equal(l.state().intake!.draft, "compare approaches");
  assert.throws(() => l.op({ op: "notes", notes: "early" }), /Intake is pending/);
  l.op({ op: "start", mission: { ...MISSION, maxToolCalls: 999, allowExec: true } }, "start-1");
  const m = l.state().mission!;
  assert.equal(l.state().intake, undefined); assert.equal(m.mode, "data"); assert.equal(m.maxToolCalls, 7);
  assert.equal(m.allowHarness, true); assert.equal(m.allowExec, false);
  assert.deepEqual(m.constraints, [...DEFAULT_SETTINGS.constraints, "Use the existing benchmark only"]);
  assert.equal((l.op({ op: "start", mission: { ...MISSION, maxToolCalls: 999, allowExec: true } }, "start-1") as { duplicate: boolean }).duplicate, true);
  assert.throws(() => l.op({ op: "start", mission: MISSION }, "start-2"), /No pending intake/);
});
test("intake start rejects missing mode and web mode with execution consent", () => {
  const l = new Ledger(); l.add(intakeEvent(l.state(), "", { ...structuredClone(DEFAULT_SETTINGS), allowHarness: true }, NOW));
  assert.throws(() => l.op({ op: "start", mission: { ...MISSION, mode: undefined } }), /mode must be one of/);
  assert.throws(() => l.op({ op: "start", mission: { ...MISSION, mode: "web" } }), /only supported in data\/mixed/);
  assert.equal(l.state().mission, undefined);
});
test("an intake blocks new starts, cannot pause, and cancel retires it", () => {
  const l = new Ledger(); l.add(intakeEvent(l.state(), "x", structuredClone(DEFAULT_SETTINGS), NOW));
  assert.throws(() => l.start(), /intake is pending/); assert.throws(() => lifecycleEvent(l.state(), "pause", NOW), /no mission pass/);
  l.add(lifecycleEvent(l.state(), "cancel", NOW)); assert.equal(l.state().intake, undefined);
  assert.equal(l.start().phase, "active");
});
test("critic brief carries the complete current evidence snapshot and its digest", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence(); l.evidence({ claim: "Second fact", stance: "contradicts" });
  const brief = l.op({ op: "read", view: "critic" }) as { instructions: string; outputSchema: { required: string[] }; evidenceIds: string[]; criticModel: string; snapshot: { evidence: unknown[]; evidenceDigest: string } };
  assert.deepEqual(brief.evidenceIds, ["E1", "E2"]); assert.equal(brief.snapshot.evidence.length, 2);
  assert.equal(brief.snapshot.evidenceDigest, evidenceDigest(l.state().mission!)); assert.equal(brief.criticModel, "test/critic");
  assert.ok(brief.outputSchema.required.includes("evidenceDigest")); assert.match(brief.instructions, /UNTRUSTED DATA/);
});
