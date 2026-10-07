import { DEFAULT_SETTINGS, ENTRY_TYPE, evidenceDigest, makeEvent, prepareOperation, restore, startEvent } from "../src/engine.ts";
import type { CriticReview, LedgerEvent, MissionConfig, Receipt, SessionEntry } from "../src/types.ts";
import { isRecord } from "../src/validation.ts";
import { CRITIC_INSTRUCTIONS } from "../src/briefs.ts";
import { snapshotHash } from "../src/receipts.ts";
export const NOW = "2026-10-06T00:00:00.000Z";
export const CWD = "/repo";
export class Ledger {
  entries: SessionEntry[] = [];
  serial = 0;
  state() { return restore(this.entries); }
  add(event: LedgerEvent) { this.entries.push({ type: "custom", customType: ENTRY_TYPE, data: structuredClone(event) }); }
  start(overrides: Partial<MissionConfig> = {}) {
    this.add(startEvent(this.state(), { ...structuredClone(DEFAULT_SETTINGS), mode: "web", objective: "Compare two approaches", primaryModel: "test/main", ...overrides }, NOW));
    return this.state().mission!;
  }
  receipt(overrides: Partial<Receipt> = {}) {
    const r: Receipt = { id: `source-${++this.serial}`, tool: "read", at: NOW, inputHash: "input", outputHash: "output", preview: "Observed source material", isError: false, metrics: {}, asi: {}, opened: ["https://example.org/paper"], links: [], ...overrides };
    this.add(makeEvent(this.state().mission!.id, "receipt_recorded", { receipt: r }, NOW)); return r;
  }
  op(input: unknown, id = `call-${++this.serial}`) {
    const p = prepareOperation(this.state(), input, id, "test/main", CWD, NOW);
    if (p.event) this.add(p.event); return p.result;
  }
  evidence(overrides: Record<string, unknown> = {}) {
    const r = this.receipt();
    return this.op({ op: "evidence", evidence: { source: "web", title: "Primary reference", claim: "Approach A supports X", summary: "Inspected the source", locator: "https://example.org/paper", receiptId: r.id, stance: "supports", ...overrides } });
  }
  /** The critic answer a critic given the current brief would return. */
  review(overrides: Partial<CriticReview> = {}): CriticReview {
    const m = this.state().mission!;
    return { assessment: "pass", summary: "Sources support the claims", concerns: [], evidenceIds: m.evidence.map(e => e.id), evidenceDigest: evidenceDigest(m), ...overrides };
  }
  /** The current `view:"critic"` snapshot, as a critic task would carry it. */
  snapshot(): Record<string, unknown> {
    const brief = prepareOperation(this.state(), { op: "read", view: "critic" }, "brief", "test/main", CWD, NOW).result;
    if (!isRecord(brief) || !isRecord(brief.snapshot)) throw new Error("critic brief without snapshot");
    return brief.snapshot;
  }
  /** A critic task item's text as the policy asks for: the brief instructions plus the snapshot JSON, verbatim. */
  brief(): string {
    return `${CRITIC_INSTRUCTIONS}\n\nSnapshot:\n\`\`\`json\n${JSON.stringify(this.snapshot(), null, 2)}\n\`\`\``;
  }
  /** A task receipt whose agent `id` ran `model` and was handed the current brief. */
  criticSpawn(id = "Crit", model = "test/critic") {
    return this.receipt({ tool: "task", agents: [{ id, requestedModel: model, briefs: [snapshotHash(this.snapshot())], instructed: true }] });
  }
}
export const VERDICT = { disposition: "conclusive", confidence: "medium", summary: "A is supported within scope", findings: [{ claim: "A supports X", evidenceIds: ["E1"] }], caveats: ["Only this workload was inspected"] };
