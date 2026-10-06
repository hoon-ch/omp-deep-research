import type { MetricContract, Mode } from "./types.ts";
import { choice, ResearchError } from "./validation.ts";

export interface ParsedSpec {
  objective: string;
  mode: Mode;
  constraints: string[];
  deliverables: string[];
  metric?: MetricContract;
}
// Gajae's `autoresearch-*` keys are accepted so a Gajae deep-interview spec works unchanged.
const KEY = (name: string) => new RegExp(`^(?:[-*]\\s+)?(?:deep-research|autoresearch)-${name}\\s*:\\s*(.+?)\\s*$`, "i");
const MODE = KEY("mode"); const METRIC = KEY("metric"); const DIRECTION = KEY("metric-direction");
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

/** Bullets directly under the first heading whose text matches, until the next heading of the same or higher level. */
function section(lines: string[], title: RegExp): string[] {
  const start = lines.findIndex(l => { const h = HEADING.exec(l); return !!h && title.test(h[2]!); });
  if (start < 0) return [];
  const level = HEADING.exec(lines[start]!)![1]!.length; const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const h = HEADING.exec(line);
    if (h && h[1]!.length <= level) break;
    const b = BULLET.exec(line);
    if (b) out.push(b[1]!);
  }
  return out;
}
function firstValue(lines: string[], re: RegExp): string | undefined {
  for (const line of lines) { const m = re.exec(line); if (m) return m[1]; }
  return undefined;
}
/**
 * Zero-question intake from a written spec (Gajae spec intake). The mode must be declared; it is never inferred.
 * Objective: first H1, else first non-empty line. Deliverables: `## Deliverables`, else `## Acceptance criteria` items.
 */
export function parseSpec(text: string, fileName: string): ParsedSpec {
  const lines = text.split(/\r?\n/);
  const modeLine = firstValue(lines, MODE);
  if (!modeLine) throw new ResearchError(`Spec ${fileName} must declare its mode with a line like "deep-research-mode: web" (web, data or mixed); the mode is never inferred`);
  const mode = choice(modeLine.toLowerCase(), ["web", "data", "mixed"], "spec mode");
  const h1 = lines.map(l => HEADING.exec(l)).find(h => h?.[1] === "#")?.[2];
  const objective = h1 ?? lines.map(l => l.trim()).find(l => l && !MODE.test(l)) ?? fileName;
  const deliverables = section(lines, /^deliverables?$/i);
  const metricName = firstValue(lines, METRIC); const direction = firstValue(lines, DIRECTION);
  if (!metricName !== !direction) throw new ResearchError("A spec metric needs both deep-research-metric and deep-research-metric-direction");
  return {
    objective, mode, constraints: section(lines, /^constraints?$/i),
    deliverables: deliverables.length ? deliverables : section(lines, /^acceptance criteria$/i),
    ...(metricName && direction ? { metric: { name: metricName, direction: choice(direction.toLowerCase(), ["lower", "higher"], "spec metric direction") } } : {}),
  };
}
