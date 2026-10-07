import { createHash } from "node:crypto";
import type { ModelIdentity, ToolResult } from "./host.ts";
import type { Receipt } from "./types.ts";
import { hash, isRecord, parseHarnessOutput } from "./validation.ts";

const PREVIEW_CHARS = 2400;
/** Task item `model` pins: a single selector (or one-element list) resolved by the host. Fallback lists prove nothing about which model ran. */
function pinnedModels(input: Record<string, unknown>, resolve: (spec: string) => ModelIdentity | undefined): string[] {
  const items = Array.isArray(input.tasks) ? input.tasks.filter(isRecord) : [input];
  return items.flatMap(item => {
    const pin = Array.isArray(item.model) && item.model.length === 1 ? item.model[0] : item.model;
    const model = typeof pin === "string" ? resolve(pin) : undefined;
    return model ? [`${model.provider}/${model.id}`] : [];
  });
}
/** Blocking task results report `details.results[].resolvedModel` (`provider/id[:thinking]`) and child ids. */
function reportedResults(details: unknown): { models: string[]; ids: string[] } {
  const results = isRecord(details) && Array.isArray(details.results) ? details.results.filter(isRecord) : [];
  return {
    models: results.flatMap(r => typeof r.resolvedModel === "string" && !r.resolvedModelIsFallback ? [r.resolvedModel.replace(/:[^/:]*$/, "")] : []),
    ids: results.flatMap(r => typeof r.id === "string" ? [r.id] : []),
  };
}
export function buildReceipt(event: ToolResult, resolve: (spec: string) => ModelIdentity | undefined, at = new Date().toISOString()): Receipt {
  const output = event.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
  const parsed = parseHarnessOutput(output);
  const sourceRefs = [...new Set([
    ...(typeof event.input.path === "string" ? [event.input.path] : []),
    ...(output.match(/https?:\/\/[^\s<>"'\])]+/g) ?? []),
  ])].slice(0, 40);
  let task: Pick<Receipt, "models" | "agentIds"> = {};
  if (event.toolName === "task") {
    const reported = reportedResults(event.details);
    // Async spawn text: "Spawned agent `id` (job `j`)." or batch rows "- `id` (job `j`)".
    const spawned = [...output.matchAll(/(?:Spawned agent |^- )`([^`]+)` \(job /gm)].map(m => m[1]!);
    task = { models: [...new Set([...reported.models, ...pinnedModels(event.input, resolve)])], agentIds: [...new Set([...reported.ids, ...spawned])] };
  }
  return { id: event.toolCallId, tool: event.toolName, at, inputHash: hash(event.input),
    outputHash: createHash("sha256").update(output).digest("hex"), preview: output.slice(0, PREVIEW_CHARS), isError: event.isError,
    metrics: parsed.metrics, ...(parsed.error ? { metricError: parsed.error } : {}), asi: parsed.asi, sourceRefs, ...task };
}
