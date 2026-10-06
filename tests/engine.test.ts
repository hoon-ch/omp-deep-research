import test from "node:test";
import assert from "node:assert/strict";
import { budgetReason, DEFAULT_SETTINGS, ENTRY_TYPE, evidenceDigest, intakeEvent, lifecycleEvent, makeEvent, modeEvent, prepareOperation, resetEvent, restore, startEvent } from "../src/engine.ts";
import { bestRun, effectToNoise } from "../src/runs.ts";
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
  const l = new Ledger(); l.start({ mode: "mixed" }); const r = l.receipt({ isError: true });
  l.evidence({ source: "experiment", locator: "local://run-output", receiptId: r.id });
  assert.equal(l.state().mission!.evidence.length, 1);
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
test("configured critic must be host-attested and review the current complete evidence snapshot", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence();
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /critic receipt/);
  const unpinned = l.receipt({ tool: "task", models: ["test/other"], agentIds: ["Crit"] });
  const base = { evaluator: "test/critic", evidenceIds: ["E1"], assessment: "pass", summary: "Source supports claim", concerns: [] };
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: unpinned.id } }), /spawnReceiptId/);
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: unpinned.id, spawnReceiptId: unpinned.id } }), /did not pin test\/critic/);
  const spawn = l.receipt({ tool: "task", models: ["test/critic"], agentIds: ["Crit"] });
  const stranger = l.receipt({ tool: "read", sourceRefs: ["agent://Other"] });
  assert.throws(() => l.op({ op: "critic", critic: { ...base, receiptId: stranger.id, spawnReceiptId: spawn.id } }), /spawning task result or a read/);
  const response = l.receipt({ tool: "read", sourceRefs: ["agent://Crit"] });
  const critic = { ...base, receiptId: response.id, spawnReceiptId: spawn.id };
  l.op({ op: "critic", critic });
  l.evidence({ claim: "New evidence" });
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  assert.throws(() => l.op({ op: "critic", critic }), /complete current evidence/);
  l.op({ op: "critic", critic: { ...critic, evidenceIds: ["E1", "E2"] } });
  l.op({ op: "verdict", verdict: VERDICT }); assert.equal(l.state().mission!.phase, "completed");
});
test("critic cannot claim the research model or bypass configured identity", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence(); const r = l.receipt();
  const critic = { evaluator: "test/main", receiptId: r.id, evidenceIds: ["E1"], assessment: "pass", summary: "Reviewed", concerns: [] };
  assert.throws(() => l.op({ op: "critic", critic }), /distinct/);
  assert.throws(() => l.op({ op: "critic", critic: { ...critic, evaluator: "test/other" } }), /Expected configured/);
});
test("revise critic blocks conclusive but permits honest inconclusive verdict", () => {
  const l = new Ledger(); l.start(); l.evidence(); const r = l.receipt();
  l.op({ op: "critic", critic: { evaluator: "test/critic", receiptId: r.id, evidenceIds: ["E1"], assessment: "revise", summary: "Need more data", concerns: ["Insufficient coverage"] } });
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
  assert.throws(() => l.evidence({ locator: "https://unobserved.example.org/fiction" }), /not observed/);
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
test("critic brief carries the complete current evidence snapshot and digest", () => {
  const l = new Ledger(); l.start({ criticModel: "test/critic" }); l.evidence(); l.evidence({ claim: "Second fact", stance: "contradicts" });
  const brief = l.op({ op: "read", view: "critic" }) as { instructions: string; evidenceIds: string[]; evidenceDigest: string; criticModel: string; snapshot: { evidence: unknown[] } };
  assert.deepEqual(brief.evidenceIds, ["E1", "E2"]); assert.equal(brief.snapshot.evidence.length, 2);
  assert.equal(brief.evidenceDigest, evidenceDigest(l.state().mission!)); assert.equal(brief.criticModel, "test/critic");
  assert.match(brief.instructions, /UNTRUSTED DATA/);
});
