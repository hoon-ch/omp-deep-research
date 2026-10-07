import { createHash } from "node:crypto";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { CRITIC_INSTRUCTIONS } from "./briefs.ts";
import type { ModelIdentity, ToolResult } from "./host.ts";
import type { CriticReview, Receipt, ReceiptFile, TaskAgent } from "./types.ts";
import { hash, isRecord, parseHarnessOutput, ResearchError } from "./validation.ts";

const PREVIEW_CHARS = 2400;
/** Tools whose results return local file content; only these can substantiate file evidence. */
export const LOCAL_CONTENT_TOOLS: Record<string, true> = { read: true, grep: true, ast_grep: true };
/** Tools whose results list local paths; with content tools, they can substantiate listing (existence) evidence. */
export const LOCAL_LISTING_TOOLS: Record<string, true> = { glob: true, find: true };
/** URLs, `www.` hosts and internal URIs (`agent://`, `local://`, `skill://`, …) are not local files. */
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;
/** Merged 1-based spans of the line numbers a result showed: `[1,2,3,7]` → `[[1,3],[7,7]]`. */
function spans(numbers: unknown[]): [number, number][] {
  const sorted = [...new Set(numbers.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}
/**
 * Files a `read` returned (OMP 18.6+ `details`): the host's link path of a single read — `resolvedPath`, else a
 * `meta.source` of type `path` (plain text reads report only the latter) — with the line numbers it showed
 * (`displayContent.lineNumbers`; `null` marks an elision). The read is complete when it showed lines 1..`totalLines`
 * (the host reports `totalLines` only when the read reached EOF), or, for non-text reads, when nothing was truncated,
 * summarized or selected. Parts of a delimited read are recorded without lines (the host drops per-part details).
 * Directory listings, URLs and internal URIs such as a scout's `agent://<id>` (whose backing file the host still
 * reports) return no local file content.
 */
function readFiles(input: Record<string, unknown>, d: Record<string, unknown>): ReceiptFile[] {
  if (Array.isArray(d.displayReadTargets)) {
    const links = Array.isArray(d.displayReadTargetLinks) ? d.displayReadTargetLinks : [];
    return d.displayReadTargets.flatMap((part, i) => {
      const link = links[i];
      return typeof part === "string" && typeof link === "string" && !NOT_LOCAL.test(part.trim()) ? [{ path: link }] : [];
    });
  }
  const spec = typeof input.path === "string" ? input.path.trim() : "";
  const meta = isRecord(d.meta) ? d.meta : {};
  const source = isRecord(meta.source) && meta.source.type === "path" ? meta.source.value : undefined;
  const file = typeof d.resolvedPath === "string" ? d.resolvedPath : source;
  if (d.isDirectory === true || d.kind === "url" || typeof file !== "string" || !spec || NOT_LOCAL.test(spec)) return [];
  const display = isRecord(d.displayContent) ? d.displayContent : undefined;
  const { startLine, text } = display ?? {};
  // A summary elides spans and its displayContent carries no line numbers, so only `lineNumbers` are trusted then.
  const numbers = Array.isArray(display?.lineNumbers) ? display.lineNumbers
    : d.summary === undefined && typeof startLine === "number" && typeof text === "string" ? text.split("\n").map((_, i) => startLine + i) : undefined;
  if (!numbers) {
    // Selectors (`:50-80`, `:raw`, archive members, sqlite tables) and `?q=` queries return part of the file.
    const partial = d.summary !== undefined || d.truncation !== undefined || meta.truncation !== undefined || /[:?][^/]*$/.test(spec.split("/").at(-1)!);
    return [{ path: file, ...(partial ? {} : { complete: true as const }) }];
  }
  const lines = spans(numbers);
  const complete = typeof d.totalLines === "number" && lines.length === 1 && lines[0]![0] === 1 && lines[0]![1] >= d.totalLines;
  return [{ path: file, lines, ...(complete ? { complete: true as const } : {}) }];
}
/**
 * Files with returned grep/ast_grep matches (`details.files`, cwd-relative) and the line numbers shown for each, parsed
 * from the host's `displayContent`: grouped output nests `# dir/` and `## name#TAG` headers over `*12│text` / ` 11│text`
 * rows; a single-file search has no headers. The searched scope is not content.
 */
function matchedFiles(d: Record<string, unknown>, cwd: string): ReceiptFile[] {
  const base = typeof d.cwd === "string" ? d.cwd : cwd;
  const files = Array.isArray(d.files) ? d.files.filter((f): f is string => typeof f === "string" && !NOT_LOCAL.test(f)) : [];
  const shown = new Map<string, number[]>();
  const rows = typeof d.displayContent === "string" ? d.displayContent.split("\n") : [];
  const grouped = rows.some(row => /^#+\s/.test(row));
  const dirs: string[] = [];
  let current = grouped || files.length !== 1 ? undefined : files[0];
  for (const row of rows) {
    const header = /^(#+)\s+(.*)$/.exec(row);
    if (header) {
      const depth = header[1]!.length; const rest = header[2]!.trimEnd();
      dirs.length = depth - 1;
      if (rest.endsWith("/")) { dirs[depth - 1] = rest.slice(0, -1).replace(/\s+\([^)]*\)$/, ""); current = undefined; continue; }
      const name = rest.replace(/\s+\([^)]*\)$/, "").replace(/#[0-9a-f]+$/i, "");
      current = [...dirs.filter(Boolean), name].join("/");
      continue;
    }
    const line = /^\s*\*?(\d+)│/.exec(row);
    if (line && current) shown.set(current, [...shown.get(current) ?? [], Number(line[1])]);
  }
  return files.map(f => ({ path: resolvePath(base, f), ...(shown.has(f) ? { lines: spans(shown.get(f)!) } : {}) }));
}
/** Paths a `glob` (`details.files`) or `find` (`details.hits[].rel`) listed, relative to the host `cwd`. */
function listedPaths(tool: string, d: Record<string, unknown>, cwd: string): string[] {
  const base = typeof d.cwd === "string" ? d.cwd : cwd;
  const raw: unknown[] = tool === "glob" ? Array.isArray(d.files) ? d.files : [] : Array.isArray(d.hits) ? d.hits.filter(isRecord).map(h => h.rel) : [];
  return raw.filter((p): p is string => typeof p === "string" && !!p && !NOT_LOCAL.test(p)).map(p => resolvePath(base, p));
}
export interface LocatorRef { file: string; ranges?: [number, number][] }
/**
 * Files and line ranges an evidence locator cites: `a.ts:10-20,30; b/c.md:4+3 (note, more), d.ts#L5-L9` →
 * `a.ts` [10,20],[30,30]; `b/c.md` [4,6]; `d.ts` [5,9]. Entries are separated by `;` or `, ` outside parentheses
 * (ranges never contain spaces). Each entry is exactly a local path with optional ranges and an optional
 * parenthesized note; anything else (`a.ts and b.ts`, URLs, internal URIs) is rejected, so no cited file can hide in
 * unchecked text. A file without a range cites the whole file.
 */
export function locatorRefs(locator: string, cwd: string): LocatorRef[] {
  const parts: string[] = []; let depth = 0; let from = 0;
  for (let i = 0; i < locator.length; i++) {
    const c = locator[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ";" || (c === "," && /\s/.test(locator[i + 1] ?? "")))) { parts.push(locator.slice(from, i)); from = i + 1; }
  }
  parts.push(locator.slice(from));
  return parts.map(part => part.trim()).filter(Boolean).map((part): LocatorRef => {
    let spec = part.split(/[\s(]/)[0]!;
    const note = part.slice(spec.length).trim();
    if (!spec || (note && !/^\((?:[^()]|\([^()]*\))*\)$/.test(note)) || NOT_LOCAL.test(spec))
      throw new ResearchError(`Locator entry "${part}" must be a local path with optional line ranges and an optional (note), e.g. src/a.ts:10-20 (parser); separate entries with ";"`);
    const anchor = /#L(\d+)(?:-L?(\d+))?$/i.exec(spec);
    spec = spec.replace(/#.*$/, "");
    const selector = /:([\d,+\-–]+)$/.exec(spec);
    if (selector) spec = spec.slice(0, selector.index);
    if (!spec) throw new ResearchError(`Locator entry "${part}" names no file`);
    const chunks = selector ? selector[1]!.split(",") : anchor ? [`${anchor[1]}-${anchor[2] ?? anchor[1]}`] : [];
    const ranges = chunks.map((chunk): [number, number] => {
      const m = /^(\d+)(?:([-–+])(\d+))?$/.exec(chunk);
      const start = Number(m?.[1]); const end = !m?.[2] ? start : m[2] === "+" ? start + Number(m[3]) - 1 : Number(m[3]);
      if (!m || start < 1 || end < start) throw new ResearchError(`Invalid line range "${chunk}" in locator ${part}; use N, N-M or N+K`);
      return [start, end];
    });
    return { file: isAbsolute(spec) ? spec : resolvePath(cwd, spec), ...(ranges.length ? { ranges } : {}) };
  });
}
/** Top-level JSON objects embedded in free text (fences, prose). Attempts are bounded: prose quotes can unbalance a scan. */
function jsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = text.indexOf("{"), attempts = 0; start !== -1 && attempts < 200; attempts++) {
    let depth = 0; let quoted = false; let end = -1;
    for (let i = start; i < text.length && end === -1; i++) {
      const c = text[i];
      if (quoted) { if (c === "\\") i++; else if (c === "\"") quoted = false; }
      else if (c === "\"") quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) end = i;
    }
    let value: unknown;
    try { value = end === -1 ? undefined : JSON.parse(text.slice(start, end + 1)); } catch { value = undefined; }
    if (isRecord(value)) found.push(value);
    start = text.indexOf("{", isRecord(value) ? end + 1 : start + 1);
  }
  return found;
}
/** A critic answer in the brief's output schema, including the digest of the snapshot it reviewed. */
function criticReview(value: unknown): CriticReview | undefined {
  if (typeof value === "string") {
    if (!value.includes("evidenceDigest")) return undefined;
    for (const object of jsonObjects(value)) { const review = criticReview(object); if (review) return review; }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { assessment, summary, concerns, evidenceIds, evidenceDigest } = value;
  const lists = [concerns, evidenceIds].every(v => Array.isArray(v) && v.length <= 100 && v.every(x => typeof x === "string"));
  if (!lists || (assessment !== "pass" && assessment !== "revise") || typeof summary !== "string" || !summary.trim()
    || typeof evidenceDigest !== "string" || !/^[0-9a-f]{64}$/.test(evidenceDigest)) return undefined;
  return { assessment, summary: summary.trim().slice(0, 12_000), concerns: (concerns as string[]).map(c => c.slice(0, 12_000)),
    evidenceIds: evidenceIds as string[], evidenceDigest };
}
/**
 * Identity of a critic snapshot as handed to a critic: key order and whitespace are irrelevant, every value is not.
 * `notes` are excluded because they change without changing what the critic judges.
 */
export function snapshotHash(snapshot: Record<string, unknown>): string {
  return hash({ ...snapshot, notes: undefined });
}
const CRITIC_TEXT = CRITIC_INSTRUCTIONS.replace(/\s+/g, " ").trim();
/**
 * What a task item's own text and the shared `context` handed its agent: stable hashes of every embedded critic
 * snapshot (an object with `evidenceDigest` and `evidence`), and whether the complete critic instructions appear
 * verbatim (whitespace-insensitive), as prose or as a JSON string value. Text added around them is not detected.
 */
function criticAssignment(texts: unknown[]): Pick<TaskAgent, "briefs" | "instructed"> {
  const briefs = new Set<string>(); let instructed = false;
  const visit = (value: unknown): void => {
    if (typeof value === "string") { instructed ||= value.replace(/\s+/g, " ").includes(CRITIC_TEXT); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    if (typeof value.evidenceDigest === "string" && Array.isArray(value.evidence)) briefs.add(snapshotHash(value));
    Object.values(value).forEach(visit);
  };
  for (const text of texts) {
    if (typeof text !== "string" || !/evidenceDigest|read-only critic/.test(text)) continue;
    visit(text); jsonObjects(text).forEach(visit);
  }
  return { ...(briefs.size ? { briefs: [...briefs] } : {}), ...(instructed ? { instructed: true as const } : {}) };
}
/** Task item `model` pin: a single selector (or one-element list) resolved by the host. Fallback lists prove nothing about which model ran. */
function pinnedModel(item: unknown, resolve: (spec: string) => ModelIdentity | undefined): string | undefined {
  if (!isRecord(item)) return undefined;
  const pin = Array.isArray(item.model) && item.model.length === 1 ? item.model[0] : item.model;
  const model = typeof pin === "string" ? resolve(pin) : undefined;
  return model && `${model.provider}/${model.id}`;
}
/**
 * One record per spawned agent. Task `details.progress[]` (async spawns) and `details.results[]` (blocking results) carry
 * the agent `id` and the `index` of its task item, so each agent is tied to its own pin, what its own assignment (with
 * the shared `context`) handed it, its reported `resolvedModel` (`provider/id[:thinking]`) and its structured output —
 * never to another item's in the same batch.
 */
function taskAgents(input: Record<string, unknown>, d: Record<string, unknown>, resolve: (spec: string) => ModelIdentity | undefined): TaskAgent[] {
  const items: unknown[] = Array.isArray(input.tasks) ? input.tasks : [input];
  const rows = [d.progress, d.results].flatMap(v => Array.isArray(v) ? v.filter(isRecord) : []);
  const agents = new Map<string, TaskAgent>();
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const agent = agents.get(row.id) ?? { id: row.id };
    const item = items[typeof row.index === "number" ? row.index : items.length === 1 ? 0 : -1];
    const requested = pinnedModel(item, resolve);
    if (requested) agent.requestedModel = requested;
    if (isRecord(item)) Object.assign(agent, criticAssignment([input.context, ...Object.values(item)]));
    if (typeof row.resolvedModel === "string") {
      if (row.resolvedModelIsFallback) agent.fallback = true;
      else agent.resolvedModel = row.resolvedModel.replace(/:[^/:]*$/, "");
    }
    const review = criticReview(row.structuredOutput) ?? criticReview(row.output);
    if (review) agent.review = review;
    agents.set(row.id, agent);
  }
  return [...agents.values()];
}
export function buildReceipt(event: ToolResult, resolve: (spec: string) => ModelIdentity | undefined, cwd: string, at = new Date().toISOString()): Receipt {
  const output = event.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
  const parsed = parseHarnessOutput(output);
  const d = isRecord(event.details) ? event.details : {};
  const links = [...new Set(output.match(/https?:\/\/[^\s<>"'\])]+/g) ?? [])].slice(0, 40);
  const extra: Partial<Receipt> = {};
  if (event.toolName === "read") {
    extra.opened = [...new Set([event.input.path, d.url, d.finalUrl].filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))];
    // Line-numbered reads keep the raw text in `displayContent`.
    const raw = isRecord(d.displayContent) && typeof d.displayContent.text === "string" ? d.displayContent.text : undefined;
    const review = criticReview(raw) ?? criticReview(output);
    if (review) extra.review = review;
  }
  if (Object.hasOwn(LOCAL_CONTENT_TOOLS, event.toolName)) extra.files = event.toolName === "read" ? readFiles(event.input, d) : matchedFiles(d, cwd);
  if (Object.hasOwn(LOCAL_LISTING_TOOLS, event.toolName)) extra.listed = listedPaths(event.toolName, d, cwd);
  if (event.toolName === "task") extra.agents = taskAgents(event.input, d, resolve);
  return { id: event.toolCallId, tool: event.toolName, at, inputHash: hash(event.input),
    outputHash: createHash("sha256").update(output).digest("hex"), preview: output.slice(0, PREVIEW_CHARS), isError: event.isError,
    metrics: parsed.metrics, ...(parsed.error ? { metricError: parsed.error } : {}), asi: parsed.asi, links, ...extra };
}
