import type { MetricContract, Mission, Run, Segment } from "./types.ts";

/** Segments reset baseline/best math when the harness, workload or metric changes; runs in other segments are history. */
export function currentSegment(m: Mission): Segment {
  return m.segments.at(-1)!;
}
export function segmentRuns(m: Mission, index = currentSegment(m).index): Run[] {
  return m.runs.filter(r => r.segment === index);
}
/** Unflagged, not crashed or failed, with a finite primary metric. Only these feed baseline/best/noise math. */
export function isValidRun(r: Run): boolean {
  return !r.flagReason && r.outcome !== "crash" && r.outcome !== "checks_failed" && Number.isFinite(r.metrics[r.primaryMetric]);
}
/** Declared segment contract, else the one fixed by the segment's first logged run. */
export function metricContract(m: Mission): MetricContract | undefined {
  const s = currentSegment(m);
  if (s.metric) return s.metric;
  const first = segmentRuns(m)[0];
  return first && { name: first.primaryMetric, direction: first.direction };
}
export function baselineRun(m: Mission, index?: number): Run | undefined {
  return segmentRuns(m, index).find(isValidRun);
}
export function bestRun(m: Mission, index?: number): Run | undefined {
  return segmentRuns(m, index).filter(isValidRun).reduce<Run | undefined>((best, r) => {
    if (!best) return r;
    const a = r.metrics[r.primaryMetric]!; const b = best.metrics[best.primaryMetric]!;
    return (r.direction === "lower" ? a < b : a > b) ? r : best;
  }, undefined);
}
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
/**
 * Gajae's run confidence: |best - baseline| / MAD over the segment's valid runs, once at least three exist.
 * A rough effect-to-noise ratio, not a significance test; null when undefined (too few runs or zero spread).
 */
export function effectToNoise(m: Mission, index?: number): number | null {
  const valid = segmentRuns(m, index).filter(isValidRun);
  if (valid.length < 3) return null;
  const values = valid.map(r => r.metrics[r.primaryMetric]!);
  const center = median(values);
  const mad = median(values.map(v => Math.abs(v - center)));
  const base = baselineRun(m, index)!; const best = bestRun(m, index)!;
  return mad === 0 ? null : Math.abs(best.metrics[best.primaryMetric]! - base.metrics[base.primaryMetric]!) / mad;
}
export interface SegmentReport {
  segment: Segment;
  metric?: MetricContract;
  runs: Run[];
  baselineId: string | null;
  bestId: string | null;
  effectToNoise: number | null;
  counts: Record<Run["outcome"] | "flagged", number>;
}
export function segmentReports(m: Mission): SegmentReport[] {
  return m.segments.map(segment => {
    const runs = segmentRuns(m, segment.index); const first = runs[0];
    const counts = { baseline: 0, keep: 0, discard: 0, crash: 0, checks_failed: 0, flagged: 0 };
    for (const r of runs) { counts[r.outcome]++; if (r.flagReason) counts.flagged++; }
    return { segment, metric: segment.metric ?? (first && { name: first.primaryMetric, direction: first.direction }), runs,
      baselineId: baselineRun(m, segment.index)?.id ?? null, bestId: bestRun(m, segment.index)?.id ?? null,
      effectToNoise: effectToNoise(m, segment.index), counts };
  });
}
/** Plain-text run table for the status command and widget. */
export function runTable(m: Mission, limit = 12): string[] {
  const r = segmentReports(m).at(-1)!;
  const head = `Segment ${r.segment.index}${r.metric ? ` · ${r.metric.name} (${r.metric.direction} is better)` : ""} · kept ${r.counts.keep}/${r.runs.length}` +
    ` · crash ${r.counts.crash} · checks_failed ${r.counts.checks_failed} · flagged ${r.counts.flagged}` +
    (r.effectToNoise === null ? "" : ` · effect/MAD ${r.effectToNoise.toFixed(2)}`);
  const rows = r.runs.slice(-limit).map(run => {
    const v = run.metrics[run.primaryMetric];
    const mark = run.id === r.bestId ? "*" : run.id === r.baselineId ? "b" : " ";
    return `${mark} ${run.id.padEnd(4)} ${run.outcome.padEnd(13)} ${(v === undefined ? "-" : String(v)).padStart(12)}  ${run.label.slice(0, 60)}${run.flagReason ? `  [flagged: ${run.flagReason.slice(0, 40)}]` : ""}`;
  });
  return [head, ...(rows.length ? rows : ["  no runs yet"])];
}
