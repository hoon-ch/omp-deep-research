import { createHash } from "node:crypto";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ModelIdentity, ToolResult } from "./host.ts";
import type { Receipt } from "./types.ts";
import { hash, isRecord, parseHarnessOutput } from "./validation.ts";

const PREVIEW_CHARS = 2400;
/** Tools whose results show local file content; only these can substantiate file evidence. */
export const LOCAL_READ_TOOLS: Record<string, true> = { read: true, grep: true, find: true, glob: true, ast_grep: true };
/** URLs, `www.` hosts and internal URIs (`agent://`, `local://`, `skill://`, …) are not local files. */
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;
/**
 * Absolute local paths a read-like call covered, selectors (`:50-80`, `:raw`) kept. Search tools without a path cover
 * the session root. `read` of an internal URI such as `agent://<id>` (a subagent's report) yields none.
 */
function localPaths(toolName: string, input: Record<string, unknown>, cwd: string): string[] {
  const raw = [input.path, input.paths].flatMap(v => typeof v === "string" ? v.split(";") : Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
  const specs = raw.map(s => s.trim()).filter(Boolean);
  if (!specs.length) return toolName === "read" ? [] : [resolvePath(cwd)];
  return specs.filter(s => !NOT_LOCAL.test(s)).map(s => isAbsolute(s) ? s : resolvePath(cwd, s));
}
/** File paths named by an evidence locator: `a.ts:10-20; b/c.md:4 (note)` → absolute `a.ts`, `b/c.md`. */
export function locatorFiles(locator: string, cwd: string): string[] {
  return locator.split(";").map(part => part.trim().split(/[\s(]/)[0]!.replace(/#.*$/, "").replace(/(?::[\d,+\-–]+)+$/, ""))
    .filter(p => p && !NOT_LOCAL.test(p)).map(p => isAbsolute(p) ? p : resolvePath(cwd, p));
}
/** A receipt path covers a file when it is that file (optionally with a selector) or a directory containing it. */
export function coversFile(receiptPath: string, file: string): boolean {
  return receiptPath === file || receiptPath.startsWith(`${file}:`) || file.startsWith(`${receiptPath.replace(/\/+$/, "")}/`);
}
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
export function buildReceipt(event: ToolResult, resolve: (spec: string) => ModelIdentity | undefined, cwd: string, at = new Date().toISOString()): Receipt {
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
  const paths = Object.hasOwn(LOCAL_READ_TOOLS, event.toolName) ? { paths: localPaths(event.toolName, event.input, cwd) } : {};
  return { id: event.toolCallId, tool: event.toolName, at, inputHash: hash(event.input),
    outputHash: createHash("sha256").update(output).digest("hex"), preview: output.slice(0, PREVIEW_CHARS), isError: event.isError,
    metrics: parsed.metrics, ...(parsed.error ? { metricError: parsed.error } : {}), asi: parsed.asi, sourceRefs, ...paths, ...task };
}
