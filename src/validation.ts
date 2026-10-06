import { createHash } from "node:crypto";
export class ResearchError extends Error {
  constructor(message: string) { super(message); this.name = "ResearchError"; }
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
export function parseMetrics(output: string): { metrics: Record<string, number>; error?: string } {
  const metrics: Record<string, number> = Object.create(null);
  for (const line of output.split(/\r?\n/)) {
    if (!/^METRIC\s/.test(line)) continue;
    const m = /^METRIC\s+([A-Za-z][A-Za-z0-9_.-]{0,63})\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$/.exec(line);
    if (!m || !Number.isFinite(Number(m[2]))) return { metrics, error: `Invalid metric line: ${line.slice(0, 160)}` };
    const key = m[1]!;
    if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(metrics, key))
      return { metrics, error: `Duplicate or reserved metric name: ${key}` };
    metrics[key] = Number(m[2]);
  }
  return { metrics };
}
