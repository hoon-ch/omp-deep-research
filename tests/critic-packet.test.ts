import test from "node:test";
import assert from "node:assert/strict";
import { evidenceDigest, modeEvent } from "../src/engine.ts";
import { isRecord } from "../src/validation.ts";
import { snapshotHash } from "../src/receipts.ts";
import { assignment, brief, CRITIC_MODEL, recordCritic } from "../bench/critic/common.ts";
import { reviewCoverage } from "../bench/critic/coverage.ts";
import { Ledger, NOW, VERDICT } from "./helpers.ts";

for (const size of [100, 101, 500]) {
  test(`a complete ${size}-item critic response can authorize a conclusive verdict`, () => {
    const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL });
    for (let i = 0; i < size; i++) l.evidence({ claim: `Package ${i} declares MIT` });
    const b = brief(l.entries);
    const result = recordCritic(l.entries, { task: assignment(b.instructions, b.snapshot) }, JSON.stringify(l.review()));
    assert.deepEqual(result, { ok: true });
    l.op({ op: "verdict", verdict: VERDICT });
    assert.equal(l.state().mission!.phase, "completed");
    assert.equal(l.state().mission!.critics[0]!.evidenceIds.length, size);
  });
}

test("large critic answers still reject missing, duplicate, substituted, extra and reordered IDs", () => {
  const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL });
  for (let i = 0; i < 101; i++) l.evidence({ claim: `Package ${i} declares MIT` });
  const b = brief(l.entries); const task = assignment(b.instructions, b.snapshot); const ids = l.review().evidenceIds;
  for (const evidenceIds of [ids.slice(1), [ids[0]!, ...ids.slice(0, -1)], [...ids.slice(0, -1), "E999"], [...ids, "E102"], [...ids].reverse()]) {
    const result = recordCritic(structuredClone(l.entries), { task }, JSON.stringify(l.review({ evidenceIds })));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /complete current evidence set/);
  }
});

test("packet versions, material evidence fields and array order are attested independently of the echoed source digest", () => {
  const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL });
  l.evidence({ claim: "Package A declares MIT" }); l.evidence({ claim: "Package B declares GPL", stance: "contradicts" });
  const b = brief(l.entries); const answer = JSON.stringify(l.review());
  assert.deepEqual(recordCritic(structuredClone(l.entries), { task: assignment(b.instructions, b.snapshot) }, answer), { ok: true });
  const mutations: Record<string, (s: Record<string, unknown>) => void> = {
    omitted_version: s => { delete s.packet; },
    altered_version: s => { s.packet = "deep-research.critic-packet.v999"; },
    altered_serialization: s => { s.serialization = "stable-json.v999"; },
    omitted_serialization: s => { delete s.serialization; },
    omitted_evidence: s => { assert.ok(Array.isArray(s.evidence)); s.evidence.pop(); },
    reordered_evidence: s => { assert.ok(Array.isArray(s.evidence)); s.evidence.reverse(); },
    edited_stance: s => { assert.ok(Array.isArray(s.evidence)); assert.ok(isRecord(s.evidence[1])); s.evidence[1].stance = "context"; },
    edited_claim: s => { assert.ok(Array.isArray(s.evidence)); assert.ok(isRecord(s.evidence[1])); s.evidence[1].claim = "Package B declares MIT"; },
    edited_locator: s => { assert.ok(Array.isArray(s.evidence)); assert.ok(isRecord(s.evidence[1])); s.evidence[1].locator = "https://example.org/other"; },
    edited_receipt: s => { assert.ok(Array.isArray(s.evidence)); assert.ok(isRecord(s.evidence[1])); s.evidence[1].receiptId = "different-tool-call"; },
    edited_requirements: s => { s.deliverables = []; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const packet = structuredClone(b.snapshot); mutate(packet);
    assert.equal(packet.evidenceDigest, evidenceDigest(l.state().mission!));
    const result = recordCritic(structuredClone(l.entries), { task: assignment(b.instructions, packet) }, answer);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.match(result.error, /did not carry the current view:"critic" snapshot/, name);
  }
});

test("coverage detects claim and metric reassignment, receipt-link loss and missing run flags", () => {
  const l = new Ledger(); l.start({ mode: "mixed", criticModel: CRITIC_MODEL, metric: { name: "latency", direction: "lower" } });
  l.evidence({ claim: "Package A declares MIT" }); l.evidence({ claim: "Package B declares GPL", stance: "contradicts" });
  const base = l.receipt({ tool: "bash", metrics: { latency: 50 }, asi: { workload: "cold" } });
  l.op({ op: "run", run: { receiptId: base.id, label: "baseline", hypothesis: "Cold-start latency" } });
  const flagged = l.receipt({ tool: "bash", metrics: { latency: 10 }, asi: { workload: "warm" } });
  l.op({ op: "run", run: { receiptId: flagged.id, label: "candidate", hypothesis: "Cache reduces latency" } });
  l.op({ op: "flag_run", runId: "R2", reason: "Warm cache is incomparable" });
  const m = l.state().mission!; const packet = brief(l.entries).snapshot;
  assert.deepEqual(reviewCoverage(m, packet), []);
  assert.ok(Array.isArray(packet.evidence));
  const swapped = structuredClone(packet);
  assert.ok(Array.isArray(swapped.evidence));
  const [a, b] = swapped.evidence;
  assert.ok(isRecord(a)); assert.ok(isRecord(b));
  [a.claim, b.claim] = [b.claim, a.claim];
  assert.deepEqual(reviewCoverage(m, swapped), ["E1.claim", "E2.claim"]);
  const altered = structuredClone(packet);
  assert.ok(Array.isArray(altered.segments)); assert.ok(isRecord(altered.segments[0]));
  const runs = altered.segments[0].runs;
  assert.ok(Array.isArray(runs)); assert.ok(isRecord(runs[0])); assert.ok(isRecord(runs[1]));
  [runs[0].metrics, runs[1].metrics] = [runs[1].metrics, runs[0].metrics];
  delete runs[1].flagReason; delete runs[1].receiptId;
  delete runs[0].segment; delete runs[0].direction; delete runs[0].primaryMetric;
  const errors = reviewCoverage(m, altered);
  assert.ok(errors.includes("R1.metrics")); assert.ok(errors.includes("R2.metrics"));
  assert.ok(errors.includes("R2.flagReason")); assert.ok(errors.includes("R2.receiptId"));
  assert.ok(errors.includes("R1.segment")); assert.ok(errors.includes("R1.direction")); assert.ok(errors.includes("R1.primaryMetric"));
});

test("versioned packets bind top-level/run notes and flags through verdict issuance", () => {
  const l = new Ledger(); l.start({ mode: "mixed", criticModel: CRITIC_MODEL, metric: { name: "latency", direction: "lower" } });
  l.evidence();
  const measured = l.receipt({ tool: "bash", metrics: { latency: 50 } });
  l.op({ op: "run", run: { receiptId: measured.id, label: "baseline", hypothesis: "Measure latency", notes: "Cold-start workload" } });
  const b = brief(l.entries); const answer = JSON.stringify(l.review());
  const packet = structuredClone(b.snapshot);
  assert.ok(Array.isArray(packet.segments)); assert.ok(isRecord(packet.segments[0]));
  const runs = packet.segments[0].runs;
  assert.ok(Array.isArray(runs)); assert.ok(isRecord(runs[0]));
  runs[0].notes = "Warm-cache workload";
  const changedRun = recordCritic(structuredClone(l.entries), { task: assignment(b.instructions, packet) }, answer);
  assert.equal(changedRun.ok, false);
  if (!changedRun.ok) assert.match(changedRun.error, /did not carry the current/);
  const task = assignment(b.instructions, b.snapshot);
  assert.deepEqual(recordCritic(l.entries, { task }, answer), { ok: true });
  const unchanged = new Ledger(); unchanged.entries = structuredClone(l.entries); unchanged.serial = l.serial;
  unchanged.op({ op: "verdict", verdict: VERDICT });
  assert.equal(unchanged.state().mission!.phase, "completed");
  l.op({ op: "notes", notes: "Next: write the verdict" });
  const changedNotes = recordCritic(structuredClone(l.entries), { task }, answer);
  assert.equal(changedNotes.ok, false);
  if (!changedNotes.ok) assert.match(changedNotes.error, /did not carry the current/);
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  const current = brief(l.entries);
  assert.deepEqual(recordCritic(l.entries, { task: assignment(current.instructions, current.snapshot) }, answer), { ok: true });
  l.op({ op: "flag_run", runId: "R1", reason: "Workload was not cold-start" });
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  const stale = recordCritic(l.entries, { task: assignment(b.instructions, b.snapshot) }, answer);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.error, /different evidence\/run snapshot/);
});

test("historical recorded critics replay without a packet hash but still reject newer evidence", () => {
  const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL }); l.evidence();
  const b = brief(l.entries);
  assert.deepEqual(recordCritic(l.entries, { task: assignment(b.instructions, b.snapshot) }, JSON.stringify(l.review())), { ok: true });
  for (const entry of l.entries) {
    if (!isRecord(entry.data) || entry.data.type !== "critic_recorded") continue;
    assert.ok(isRecord(entry.data.data)); assert.ok(isRecord(entry.data.data.critic));
    // The persisted critic shape emitted before review packets had no snapshotHash.
    delete entry.data.data.critic.snapshotHash;
  }
  l.op({ op: "notes", notes: "Legacy notes did not invalidate a recorded critic" });
  const newer = new Ledger(); newer.entries = structuredClone(l.entries); newer.serial = l.serial;
  newer.evidence({ claim: "New evidence after the legacy review" });
  assert.throws(() => newer.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  l.op({ op: "verdict", verdict: VERDICT });
  assert.equal(l.state().mission!.phase, "completed");
  assert.equal(l.state().mission!.critics[0]!.snapshotHash, undefined);
});

test("neither critic JSON nor the recording caller can substitute the host packet hash", () => {
  const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL }); l.evidence();
  const b = brief(l.entries); const expected = snapshotHash(b.snapshot); const forged = "0".repeat(64);
  assert.deepEqual(recordCritic(l.entries, { task: assignment(b.instructions, b.snapshot) },
    JSON.stringify({ ...l.review(), snapshotHash: forged })), { ok: true });
  assert.equal(l.state().mission!.critics.at(-1)!.snapshotHash, expected);
  const spawn = l.criticSpawn("Second", CRITIC_MODEL);
  const response = l.receipt({ tool: "read", opened: ["agent://Second"], review: l.review() });
  l.op({ op: "critic", critic: { evaluator: CRITIC_MODEL, receiptId: response.id, spawnReceiptId: spawn.id, snapshotHash: forged } });
  assert.equal(l.state().mission!.critics.at(-1)!.snapshotHash, expected);
});

test("mode changes invalidate new packet reviews without relabelling a stale critic on inconclusive output", () => {
  const l = new Ledger(); l.start({ criticModel: CRITIC_MODEL }); l.evidence();
  const b = brief(l.entries);
  assert.deepEqual(recordCritic(l.entries, { task: assignment(b.instructions, b.snapshot) }, JSON.stringify(l.review())), { ok: true });
  const digest = evidenceDigest(l.state().mission!);
  l.add(modeEvent(l.state(), "mixed", NOW));
  assert.equal(evidenceDigest(l.state().mission!), digest);
  assert.throws(() => l.op({ op: "verdict", verdict: VERDICT }), /CURRENT/);
  l.op({ op: "verdict", verdict: { ...VERDICT, disposition: "inconclusive", caveats: ["Mode changed after review; a new critic is required"] } });
  assert.equal(l.state().mission!.verdicts.at(-1)!.criticId, undefined);
});
