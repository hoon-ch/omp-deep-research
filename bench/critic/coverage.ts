/** Independent benchmark check: reviewable values must remain attached to the same evidence/run/segment IDs. */
import { evidenceDigest } from "../../src/engine.ts";
import { segmentReports } from "../../src/runs.ts";
import type { Mission } from "../../src/types.ts";
import { isRecord, stable } from "../../src/validation.ts";

export function reviewCoverage(m: Mission, packet: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const same = (path: string, actual: unknown, expected: unknown) => { if (stable(actual) !== stable(expected)) errors.push(path); };
  for (const key of ["objective", "mode", "constraints", "deliverables", "notes"] as const) same(key, packet[key], m[key]);
  same("evidenceDigest", packet.evidenceDigest, evidenceDigest(m));
  const evidence = Array.isArray(packet.evidence) ? packet.evidence : [];
  same("evidence.length", evidence.length, m.evidence.length);
  m.evidence.forEach((expected, i) => {
    const actual = evidence[i];
    if (!isRecord(actual)) { errors.push(`evidence[${i}]`); return; }
    for (const key of ["id", "source", "stance", "title", "claim", "summary", "locator", "receiptId"] as const)
      same(`${expected.id}.${key}`, actual[key], expected[key]);
  });
  const segments = Array.isArray(packet.segments) ? packet.segments : [];
  const expectedSegments = segmentReports(m);
  same("segments.length", segments.length, expectedSegments.length);
  expectedSegments.forEach((expected, index) => {
    const actual = segments[index];
    if (!isRecord(actual) || !isRecord(actual.segment)) { errors.push(`segments[${index}]`); return; }
    for (const key of ["index", "at", "reason", "metric"] as const) same(`segment${index}.${key}`, actual.segment[key], expected.segment[key]);
    for (const key of ["metric", "baselineId", "bestId", "effectToNoise", "counts"] as const) same(`segment${index}.${key}`, actual[key], expected[key]);
    const runs = Array.isArray(actual.runs) ? actual.runs : [];
    same(`segment${index}.runs.length`, runs.length, expected.runs.length);
    expected.runs.forEach((run, i) => {
      const received = runs[i];
      if (!isRecord(received)) { errors.push(`${run.id}.missing`); return; }
      for (const key of ["id", "at", "segment", "primaryMetric", "direction", "label", "hypothesis", "receiptId", "metrics", "asi", "outcome", "checksPassed", "notes", "flagReason"] as const)
        same(`${run.id}.${key}`, received[key], run[key]);
    });
  });
  return errors;
}
