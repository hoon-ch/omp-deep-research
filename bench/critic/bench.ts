/**
 * Deterministic critic benchmark: token proxy for every critic invocation of the frozen suite, structural content
 * coverage of what the critic receives, and attestation/integrity scenarios through the real receipt and op:"critic"
 * path. Prints `METRIC name=value` lines. Usage: node --experimental-strip-types bench/critic/bench.ts [--json out.json]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { evidenceDigest, makeEvent, prepareOperation, restore } from "../../src/engine.ts";
import type { Receipt, SessionEntry } from "../../src/types.ts";
import { isRecord } from "../../src/validation.ts";
import { AGENT_BODY, appendEvent, assignment, brief, countTokens, CRITIC_MODEL, type Recorded, recordCritic, researchTexts, type Spawn } from "./common.ts";
import { buildCases, caseHash, CWD } from "./fixtures.ts";

const cases = buildCases();
const lock = JSON.parse(readFileSync(new URL("./fixtures.lock.json", import.meta.url), "utf8")) as Record<string, string>;
const drift = cases.filter(c => lock[c.id] !== caseHash(c)).map(c => c.id);
if (drift.length || Object.keys(lock).length !== cases.length) throw new Error(`Fixtures differ from fixtures.lock.json: ${drift.join(", ") || "case count"}`);

/** Retries counted in the suite: one failed first attempt for each clean size class. */
const RETRIED = ["A-small-clean-5", "B-large-clean-25", "B-large-clean-100", "B-large-clean-500"];

// --- token proxy -----------------------------------------------------------------------------------------------------
const rows = cases.map(c => { const b = brief(c.entries); const text = assignment(b.instructions, b.snapshot); return { c, b, text, research: researchTexts(b, text) }; });
const counts = countTokens([AGENT_BODY, ...rows.flatMap(r => [r.text, ...r.research])]);
const system = counts[0]!;
const perCase = rows.map((r, i) => ({ id: r.c.id, size: r.c.size, evidence: r.c.mission.evidence.length, runs: r.c.mission.runs.length,
  critic: system + counts[1 + i * 3]!, research: counts[2 + i * 3]! + counts[3 + i * 3]!, chars: r.text.length,
  invocations: RETRIED.includes(r.c.id) ? 2 : 1 }));
const criticTotal = perCase.reduce((s, r) => s + r.critic * r.invocations, 0);
const invocations = perCase.reduce((s, r) => s + r.invocations, 0);
const researchTotal = perCase.reduce((s, r) => s + r.research * r.invocations, 0);

// --- content coverage: every reviewable atom of the mission reaches the critic ---------------------------------------
function atoms(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.add(String(value));
  else if (Array.isArray(value)) value.forEach(v => atoms(v, out));
  else if (isRecord(value)) Object.entries(value).forEach(([k, v]) => { out.add(k); atoms(v, out); });
  return out;
}
const coverage = rows.map(({ c, b }) => {
  const seen = atoms(b.snapshot); const m = c.mission; const missing: string[] = [];
  const need = (label: string, v: unknown) => { if (v !== undefined && !seen.has(String(v))) missing.push(`${label}=${String(v).slice(0, 40)}`); };
  need("objective", m.objective); need("mode", m.mode); m.constraints.forEach(v => need("constraint", v)); m.deliverables.forEach(v => need("deliverable", v));
  need("digest", evidenceDigest(m));
  for (const e of m.evidence) for (const k of ["id", "source", "stance", "title", "claim", "summary", "locator"] as const) need(`${e.id}.${k}`, e[k]);
  for (const r of m.runs) {
    for (const k of ["id", "label", "hypothesis", "outcome", "flagReason", "notes", "checksPassed"] as const) need(`${r.id}.${k}`, r[k]);
    for (const [k, v] of Object.entries(r.metrics)) { need(`${r.id}.metric`, k); need(`${r.id}.${k}`, v); }
  }
  for (const s of m.segments) { need(`segment${s.index}.reason`, s.reason); need(`segment${s.index}.metric`, s.metric?.name); need(`segment${s.index}.direction`, s.metric?.direction); }
  return { id: c.id, missing };
});
const coverageRate = coverage.filter(c => !c.missing.length).length / coverage.length;

// --- attestation and integrity scenarios ------------------------------------------------------------------------------
type Mutation = (s: Record<string, unknown>) => void;
function walk(value: unknown, visit: (holder: object, key: string | number, v: unknown) => boolean): boolean {
  if (Array.isArray(value)) return value.some((v, i) => visit(value, i, v) || walk(v, visit));
  if (isRecord(value)) return Object.entries(value).some(([k, v]) => visit(value, k, v) || walk(v, visit));
  return false;
}
function evidenceOf(s: Record<string, unknown>): unknown[] { if (!Array.isArray(s.evidence)) throw new Error("snapshot without evidence array"); return s.evidence; }
const replaceString = (match: (v: string) => boolean, next: string | undefined): Mutation => s => {
  if (!walk(s, (holder, key, v) => {
    if (typeof v !== "string" || !match(v)) return false;
    if (next === undefined && !Array.isArray(holder)) Reflect.deleteProperty(holder, key); else Reflect.set(holder, key, next ?? null);
    return true;
  })) throw new Error("mutation target not found");
};
const MUTATIONS: Record<string, Mutation> = {
  modified_claim: s => { const ev = evidenceOf(s); const el = ev[Math.floor(ev.length / 2)];
    if (!isRecord(el) && !Array.isArray(el)) throw new Error("evidence item is not structured");
    const [key, value] = Object.entries(el).filter(([, v]) => typeof v === "string").sort(([, a], [, b]) => String(b).length - String(a).length)[0]!;
    Reflect.set(el, Array.isArray(el) ? Number(key) : key, `${String(value)} This was independently confirmed.`); },
  omitted_item: s => { const ev = evidenceOf(s); ev.splice(Math.floor(ev.length / 2), 1); },
  reordered_items: s => { const ev = evidenceOf(s); const i = Math.floor(ev.length / 2); [ev[i], ev[i - 1]] = [ev[i - 1], ev[i]]; },
};
const RUN_MUTATIONS: Record<string, Mutation> = {
  run_outcome_modified: replaceString(v => v === "crash", "keep"),
  flag_removed: replaceString(v => v.includes("warm on-disk cache"), undefined),
  segment_dropped: s => { if (!Array.isArray(s.segments)) throw new Error("snapshot without segments"); s.segments.pop(); },
};
function deepReverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReverse);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, deepReverse(v)]));
  return value;
}
function answer(entries: SessionEntry[], overrides: Record<string, unknown> = {}): string {
  const m = restore(entries).mission!;
  return JSON.stringify({ assessment: "pass", summary: "The snapshot supports a conclusive verdict.", concerns: [], evidenceIds: m.evidence.map(e => e.id),
    evidenceDigest: String(brief(entries).snapshot.evidenceDigest), ...overrides });
}
/** Adds one more file evidence item, making every earlier brief stale. */
function grow(entries: SessionEntry[]): void {
  const rel = "vendor/late-arrival/package.json";
  const receipt: Receipt = { id: `late-${entries.length}`, tool: "read", at: "2026-09-30T00:00:00.000Z", inputHash: "0", outputHash: "0", preview: "", isError: false, metrics: {}, asi: {}, links: [],
    opened: [rel], files: [{ path: `${CWD}/${rel}`, lines: [[1, 20]], complete: true }] };
  appendEvent(entries, makeEvent(restore(entries).mission!.id, "receipt_recorded", { receipt }, receipt.at));
  appendEvent(entries, prepareOperation(restore(entries), { op: "evidence", evidence: { source: "file", locator: `${rel}:4-4`, title: "Late manifest", claim: "vendor/late-arrival declares the MIT license.",
    summary: "Line 4 reads \"license\": \"MIT\".", receiptId: receipt.id, stance: "supports" } }, `late-ev-${entries.length}`, "bench/main", CWD).event);
}
interface Scenario { name: string; group: "valid" | "attestation" | "integrity"; expect: boolean; run(entries: SessionEntry[]): Recorded }
function scenarios(withRuns: boolean): Scenario[] {
  const handed = (entries: SessionEntry[], mutate?: Mutation, instructions?: (i: string) => string, pretty = false): string => {
    const b = brief(entries); const s = structuredClone(b.snapshot); mutate?.(s);
    const text = assignment(instructions ? instructions(b.instructions) : b.instructions, pretty ? deepReverse(s) : s);
    return pretty ? text.replace(JSON.stringify(deepReverse(s)), JSON.stringify(deepReverse(s), null, 2)) : text;
  };
  const plain = (expect: boolean, name: string, group: Scenario["group"], spawn: (e: SessionEntry[]) => Spawn, ans?: (e: SessionEntry[]) => string, evaluator?: string): Scenario =>
    ({ name, group, expect, run: e => recordCritic(e, spawn(e), ans ? ans(e) : answer(e), evaluator) });
  const list: Scenario[] = [
    plain(true, "valid", "valid", e => ({ task: handed(e) })),
    plain(true, "reformatted_keys_whitespace", "integrity", e => ({ task: handed(e, undefined, undefined, true) })),
    plain(true, "notes_edited", "integrity", e => ({ task: handed(e, s => { s.notes = "Edited after the brief was read."; }) })),
    { name: "stale_digest", group: "attestation", expect: false, run: e => { const old = answer(e); const task = handed(e); grow(e); return recordCritic(e, { task }, old); } },
    { name: "stale_packet", group: "attestation", expect: false, run: e => { const task = handed(e); grow(e); return recordCritic(e, { task }, answer(e)); } },
    plain(false, "wrong_role_model", "attestation", e => ({ task: handed(e), roleModel: "openai-codex/gpt-6-astra" })),
    plain(false, "host_fallback_model", "attestation", e => ({ task: handed(e), resolvedModel: "xai-oauth/grok-4.7:high", fallback: true })),
    plain(false, "substituted_evaluator", "attestation", e => ({ task: handed(e) }), undefined, "openai-codex/gpt-6-astra"),
    plain(false, "truncated_instructions", "integrity", e => ({ task: handed(e, undefined, i => i.slice(0, i.lastIndexOf("\n- If the snapshot"))) })),
    plain(false, "answer_missing_id", "attestation", e => ({ task: handed(e) }), e => answer(e, { evidenceIds: restore(e).mission!.evidence.slice(1).map(x => x.id) })),
    plain(false, "answer_altered_digest", "attestation", e => ({ task: handed(e) }), e => { const d = String(brief(e).snapshot.evidenceDigest); return answer(e, { evidenceDigest: (d[0] === "a" ? "b" : "a") + d.slice(1) }); }),
    ...Object.entries(MUTATIONS).map(([name, m]) => plain(false, name, "integrity", e => ({ task: handed(e, m) }))),
  ];
  if (withRuns) list.push(...Object.entries(RUN_MUTATIONS).map(([name, m]) => plain(false, name, "integrity", e => ({ task: handed(e, m) }))));
  return list;
}
const STRUCTURAL = ["A-small-clean-5", "B-large-clean-25", "B-large-clean-100", "B-large-clean-500", "D-experiments-20", "D-experiments-120"];
const results = cases.filter(c => STRUCTURAL.includes(c.id)).flatMap(c => scenarios(c.mission.runs.length > 0).map(s => {
  const r = s.run(structuredClone(c.entries));
  return { case: c.id, scenario: s.name, group: s.group, expect: s.expect, accepted: r.ok, error: r.ok ? undefined : r.error, correct: r.ok === s.expect };
}));
const wrong = (g: string) => results.filter(r => r.group === g && !r.correct).length;

const out = {
  tokenizer: "o200k_base (proxy)", criticModel: CRITIC_MODEL, suiteHash: createHash("sha256").update(JSON.stringify(lock)).digest("hex"),
  systemTokens: system, invocations, criticTotal, researchTotal, perCase, coverage: coverage.filter(c => c.missing.length), results: results.filter(r => !r.correct),
};
const json = process.argv.indexOf("--json");
if (json !== -1) writeFileSync(process.argv[json + 1]!, JSON.stringify({ ...out, results }, null, 2));
for (const r of perCase) console.log(`${r.id.padEnd(26)} ev=${String(r.evidence).padStart(3)} runs=${String(r.runs).padStart(3)} critic=${String(r.critic).padStart(7)} research=${String(r.research).padStart(7)}${r.invocations > 1 ? " (x2 retry)" : ""}`);
for (const r of results.filter(r => !r.correct)) console.log(`WRONG ${r.case} ${r.scenario}: expected ${r.expect ? "accept" : "reject"}, got ${r.accepted ? "accept" : `reject (${r.error})`}`);
for (const c of out.coverage) console.log(`MISSING ${c.id}: ${c.missing.slice(0, 5).join(", ")}${c.missing.length > 5 ? ` … +${c.missing.length - 5}` : ""}`);
const bySize = (id: string) => perCase.find(r => r.id === id)!.critic;
console.log(`METRIC critic_input_tokens=${criticTotal}`);
console.log(`METRIC critic_input_tokens_per_review=${Math.round(criticTotal / invocations)}`);
for (const [n, id] of [[5, "A-small-clean-5"], [25, "B-large-clean-25"], [100, "B-large-clean-100"], [500, "B-large-clean-500"]] as const) console.log(`METRIC critic_tokens_size_${n}=${bySize(id)}`);
console.log(`METRIC critic_tokens_runs_120=${bySize("D-experiments-120")}`);
console.log(`METRIC total_research_tokens=${researchTotal}`);
console.log(`METRIC evidence_coverage_rate=${coverageRate}`);
console.log(`METRIC attestation_failure_count=${wrong("attestation") + wrong("valid")}`);
console.log(`METRIC snapshot_integrity_failure_count=${wrong("integrity")}`);
console.log(`METRIC structural_scenarios=${results.length}`);
