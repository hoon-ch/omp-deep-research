import type { SchemaBuilder } from "./host.ts";
export function toolSchema(z: SchemaBuilder) {
  const s = () => z.string(); const list = () => z.array(s());
  const metric = () => z.object({ name: s(), direction: z.enum(["lower", "higher"]) });
  return z.object({
    op: z.enum(["read", "start", "evidence", "segment", "run", "flag_run", "notes", "critic", "verdict", "export"]),
    view: z.enum(["summary", "full", "receipts", "runs", "explore", "critic", "iterate"]).optional(),
    mission: z.object({ objective: s(), mode: z.enum(["web", "data", "mixed"]), constraints: list(), deliverables: list(), metric: metric().optional() }).optional(),
    limit: z.number().optional(), offset: z.number().optional(), requestId: s().optional(),
    evidence: z.object({ source: z.enum(["web", "file", "listing", "experiment"]), title: s(), claim: s(), summary: s(), locator: s(), receiptId: s(), stance: z.enum(["supports", "contradicts", "context"]) }).optional(),
    segment: z.object({ reason: s(), metric: metric().optional() }).optional(),
    run: z.object({ label: s(), hypothesis: s(), receiptId: s(), primaryMetric: s().optional(), direction: z.enum(["lower", "higher"]).optional(), checksPassed: z.boolean().optional(), notes: s().optional() }).optional(),
    runId: s().optional(), reason: s().optional(), notes: s().optional(),
    critic: z.object({ evaluator: s(), receiptId: s(), spawnReceiptId: s() }).optional(),
    verdict: z.object({ disposition: z.enum(["conclusive", "inconclusive"]), confidence: z.enum(["low", "medium", "high"]), summary: s(),
      findings: z.array(z.object({ claim: s(), evidenceIds: list() })), caveats: list() }).optional(),
  });
}
