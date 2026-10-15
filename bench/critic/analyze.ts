/**
 * Context-cost breakdown of the critic assignment: token deltas when one component is removed from (or alone forms)
 * the assignment, for selected suite cases. Keys are removed wherever they occur, so the breakdown follows whatever
 * shape the current critic snapshot has. Usage: node --experimental-strip-types bench/critic/analyze.ts
 */
import { isRecord } from "../../src/validation.ts";
import { AGENT_BODY, assignment, brief, countTokens, researchTexts } from "./common.ts";
import { buildCases } from "./fixtures.ts";

const CASES = ["A-small-clean-5", "B-large-clean-25", "B-large-clean-100", "B-large-clean-500", "C-long-text-25", "D-experiments-120"];
function drop(value: unknown, keys: string[], where?: string, inside = false): unknown {
  if (Array.isArray(value)) return value.map(v => drop(v, keys, where, inside));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !(keys.includes(k) && (!where || inside))).map(([k, v]) => [k, drop(v, keys, where, inside || k === where)]));
}
const ABLATIONS: Record<string, (s: Record<string, unknown>) => unknown> = {
  "evidence claim+summary": s => drop(s, ["claim", "summary"], "evidence"),
  "evidence title+locator": s => drop(s, ["title", "locator"], "evidence"),
  "evidence source+stance+id": s => drop(s, ["source", "stance", "id"], "evidence"),
  "evidence fingerprint": s => drop(s, ["fingerprint"], "evidence"),
  "evidence at": s => drop(s, ["at"], "evidence"),
  "evidence receiptId": s => drop(s, ["receiptId"], "evidence"),
  "all run records": s => drop(s, ["runs"], "segments"),
  "run at+segment+receiptId": s => drop(s, ["at", "segment", "receiptId"], "runs"),
  "run primaryMetric+direction": s => drop(s, ["primaryMetric", "direction"], "runs"),
  "run metrics+asi": s => drop(s, ["metrics", "asi"], "runs"),
  "run label+hypothesis+notes+flagReason": s => drop(s, ["label", "hypothesis", "notes", "flagReason"], "runs"),
  "segment header (segment,counts,ids)": s => drop(s, ["segment", "counts", "baselineId", "bestId", "effectToNoise", "metric"], "segments"),
  "mission metadata": s => drop(s, ["objective", "mode", "constraints", "deliverables"]),
  "notes": s => drop(s, ["notes"]),
  "evidenceDigest": s => drop(s, ["evidenceDigest"]),
};
const cases = buildCases().filter(c => CASES.includes(c.id));
const texts: string[] = [AGENT_BODY];
const plan = cases.map(c => {
  const b = brief(c.entries); const full = assignment(b.instructions, b.snapshot);
  const start = texts.length;
  texts.push(full, b.instructions, JSON.stringify(b.snapshot), ...Object.values(ABLATIONS).map(f => assignment(b.instructions, f(structuredClone(b.snapshot)))), ...researchTexts(b, full));
  return { c, start };
});
const n = countTokens(texts);
const names = Object.keys(ABLATIONS);
console.log(`critic agent body (system prompt): ${n[0]} tokens`);
console.log(["component", ...plan.map(p => p.c.id)].join("\t"));
const row = (label: string, f: (base: number, p: (typeof plan)[number]) => number) => console.log([label, ...plan.map(p => String(f(p.start, p)))].join("\t"));
row("assignment total", s => n[s]!);
row("instructions + wrapper", s => n[s]! - n[s + 2]!);
row("snapshot JSON", s => n[s + 2]!);
names.forEach((name, i) => row(`- ${name}`, s => n[s]! - n[s + 3 + i]!));
row("research: view result (pretty)", s => n[s + 3 + names.length]!);
row("research: task call args", s => n[s + 4 + names.length]!);
