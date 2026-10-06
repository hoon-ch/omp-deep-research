import { DEFAULT_SETTINGS, ENTRY_TYPE, makeEvent, prepareOperation, restore, startEvent } from "../src/engine.ts";
import type { LedgerEvent, MissionConfig, Receipt, SessionEntry } from "../src/types.ts";
export const NOW = "2026-10-06T00:00:00.000Z";
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
    const r: Receipt = { id: `source-${++this.serial}`, tool: "read", at: NOW, inputHash: "input", outputHash: "output", preview: "Observed source material", isError: false, metrics: {}, asi: {}, sourceRefs: ["https://example.org/paper"], ...overrides };
    this.add(makeEvent(this.state().mission!.id, "receipt_recorded", { receipt: r }, NOW)); return r;
  }
  op(input: unknown, id = `call-${++this.serial}`) {
    const p = prepareOperation(this.state(), input, id, "test/main", NOW);
    if (p.event) this.add(p.event); return p.result;
  }
  evidence(overrides: Record<string, unknown> = {}) {
    const r = this.receipt();
    return this.op({ op: "evidence", evidence: { source: "web", title: "Primary reference", claim: "Approach A supports X", summary: "Inspected the source", locator: "https://example.org/paper", receiptId: r.id, stance: "supports", ...overrides } });
  }
}
export const VERDICT = { disposition: "conclusive", confidence: "medium", summary: "A is supported within scope", findings: [{ claim: "A supports X", evidenceIds: ["E1"] }], caveats: ["Only this workload was inspected"] };
