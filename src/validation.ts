import { createHash } from "node:crypto";
import type { AsiValue } from "./types.ts";
export class ResearchError extends Error {
  constructor(message: string) { super(message); this.name = "ResearchError"; }
}
export function positiveNumber(value: unknown, name: string, max: number, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value > max || (allowZero ? value < 0 : value <= 0))
    throw new ResearchError(`${name} must be a ${allowZero ? "non-negative" : "positive"} number up to ${max}`);
  return value;
}
/** The package's single plain-object guard; fields stay `unknown` and are checked where read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function object(value: unknown, name = "input"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 12_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ResearchError(`${name} must be non-empty text (at most ${max} characters)`);
  return value.trim();
}
export function strings(value: unknown, name: string, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max) throw new ResearchError(`${name} must be an array with at most ${max} entries`);
  return value.map((v, i) => text(v, `${name}[${i}]`));
}
export function choice<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new ResearchError(`${name} must be one of: ${allowed.join(", ")}`);
  return value as T;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new ResearchError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function hash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
const URL_RANGE_SOURCE = String.raw`L?\d+(?:(?:\.\.|[-+])L?\d*)?(?:,L?\d+(?:(?:\.\.|[-+])L?\d*)?)*`;
const URL_READ_SELECTOR = new RegExp(`(?::(?:raw|conflicts|${URL_RANGE_SOURCE}))+$`, "i");
export function urlFetchTarget(entry: string): string {
  const authority = /^https?:\/\/[^/?#]+(?=\/)/i.exec(entry);
  const selector = URL_READ_SELECTOR.exec(entry);
  if (!authority || !selector || selector.index <= authority[0].length) return entry;
  const chunks = selector[0].slice(1).toLowerCase().split(":");
  if (chunks.length === 1 && (chunks[0] === "raw" || chunks[0] === "conflicts")) return entry.slice(0, selector.index);
  if (chunks.length > 2 || (chunks.length === 2 && !chunks.includes("raw"))) return entry;
  const range = chunks[chunks[0] === "raw" ? 1 : 0];
  if (!range || !range.split(",").every(chunk => {
    const match = /^l?(\d+)(?:(\.\.|[-+])l?(\d+)?)?$/.exec(chunk);
    if (!match || Number(match[1]) < 1) return false;
    return match[2] === "+" ? Number(match[3]) >= 1 : match[3] === undefined || Number(match[3]) >= Number(match[1]);
  })) return entry;
  return entry.slice(0, selector.index);
}
export function canonicalUrl(value: string): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new ResearchError("Web evidence requires an absolute HTTP(S) locator"); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new ResearchError("Web evidence requires HTTP(S), without embedded credentials");
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}
// A Set, not a Record: `__proto__` cannot be a plain own key of an object literal.
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/**
 * Harness output contract (Gajae `autoresearch.sh`): `METRIC name=<number>` lines are strict (one bad line invalidates the
 * run); `ASI key=value` learning lines are informational, so malformed or reserved ones are skipped.
 */
export function parseHarnessOutput(output: string): { metrics: Record<string, number>; asi: Record<string, AsiValue>; error?: string } {
  const metrics: Record<string, number> = Object.create(null);
  const asi: Record<string, AsiValue> = Object.create(null);
  let error: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    const a = /^ASI\s+([A-Za-z][A-Za-z0-9_.-]{0,63})\s*=\s*(.{1,500}?)\s*$/.exec(line);
    if (a) {
      const raw = a[2]!;
      if (!RESERVED_KEYS.has(a[1]!) && !Object.hasOwn(asi, a[1]!))
        asi[a[1]!] = raw === "true" ? true : raw === "false" ? false : /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      continue;
    }
    if (error || !/^METRIC\s/.test(line)) continue;
    const m = /^METRIC\s+([A-Za-z][A-Za-z0-9_.-]{0,63})\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$/.exec(line);
    if (!m || !Number.isFinite(Number(m[2]))) { error = `Invalid metric line: ${line.slice(0, 160)}`; continue; }
    const key = m[1]!;
    if (RESERVED_KEYS.has(key) || Object.hasOwn(metrics, key)) { error = `Duplicate or reserved metric name: ${key}`; continue; }
    metrics[key] = Number(m[2]);
  }
  return { metrics, asi, ...(error ? { error } : {}) };
}
