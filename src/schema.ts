import type { SchemaBuilder } from "./host.ts";
export function toolSchema(z: SchemaBuilder) {
  const s = () => z.string(); const list = () => z.array(s());
  return z.object({
    op: z.enum(["read", "evidence", "run", "flag_run", "notes", "critic", "verdict", "export"]),
    view: z.enum(["summary", "full", "receipts"]).optional(),
    limit: z.number().optional(), offset: z.number().optional(), requestId: s().optional(),
    evidence: z.object({ source: z.enum(["web", "file", "experiment"]), title: s(), claim: s(), summary: s(), locator: s(), receiptId: s(), stance: z.enum(["supports", "contradicts", "context"]) }).optional(),
    run: z.object({ label: s(), hypothesis: s(), receiptId: s(), primaryMetric: s(), direction: z.enum(["lower", "higher"]), checksPassed: z.boolean().optional(), notes: s().optional() }).optional(),
    runId: s().optional(), reason: s().optional(), notes: s().optional(),
    critic: z.object({ evaluator: s(), receiptId: s(), evidenceIds: list(), assessment: z.enum(["pass", "revise"]), summary: s(), concerns: list() }).optional(),
    verdict: z.object({ disposition: z.enum(["conclusive", "inconclusive"]), confidence: z.enum(["low", "medium", "high"]), summary: s(),
      findings: z.array(z.object({ claim: s(), evidenceIds: list() })), caveats: list() }).optional(),
  });
}
