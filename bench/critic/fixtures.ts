/**
 * Frozen critic benchmark fixtures. Every mission is built through the real engine (`prepareOperation`), so evidence,
 * runs, segments and flags pass the same validation a live mission does. Content is deterministic (seeded PRNG, fixed
 * clock); `fixtures.lock.json` pins a hash of every case's reviewed state and reference judgment.
 */
import { ENTRY_TYPE, makeEvent, prepareOperation, restore, startEvent } from "../../src/engine.ts";
import type { LedgerEvent, Mission, MissionConfig, Receipt, SessionEntry } from "../../src/types.ts";
import { hash } from "../../src/validation.ts";

export const CWD = "/repo";
const MAIN = "anthropic/claude-opus-5-5";

export type PlantKind = "contradiction" | "unsupported" | "invalid_run" | "incomplete";
/** A planted defect: detected when the critic answers "revise" and names one of `ids` (or, for incomplete, a keyword). */
export interface Plant { kind: PlantKind; ids: string[]; keywords?: string[]; note: string }
export interface Case {
  id: string;
  category: string;
  /** Approximate evidence count bucket (5, 25, 100, 500); experiment cases use their run count. */
  size: number;
  mission: Mission;
  /** The case's ledger, so a harness can append receipts and critic operations. */
  entries: SessionEntry[];
  expected: { assessment: "pass" | "revise"; plants: Plant[] };
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

class Builder {
  entries: SessionEntry[] = [];
  private clock = Date.parse("2026-09-01T09:00:00.000Z");
  private rand: () => number;
  private calls = 0;
  constructor(seed: number) { this.rand = prng(seed); }
  int(lo: number, hi: number): number { return lo + Math.floor(this.rand() * (hi - lo + 1)); }
  private at(): string { this.clock += 4_000 + Math.floor(this.rand() * 40_000); return new Date(this.clock).toISOString(); }
  /** Anthropic-style tool call id, as a live ledger stores it. */
  private toolId(): string { let s = "toolu_01"; for (let i = 0; i < 22; i++) s += B62[Math.floor(this.rand() * 62)]; return s; }
  state() { return restore(this.entries); }
  mission(): Mission { return structuredClone(this.state().mission!); }
  private add(e: LedgerEvent) { this.entries.push({ type: "custom", customType: ENTRY_TYPE, data: e }); }
  start(config: Pick<MissionConfig, "objective" | "mode" | "constraints" | "deliverables"> & Partial<MissionConfig>) {
    this.add(startEvent(this.state(), { maxContinuations: 6, maxToolCalls: 600, maxChildren: 8, maxMinutes: 240, allowExec: false,
      allowHarness: config.mode !== "web", criticModel: "openai-codex/gpt-6.1-sol", primaryModel: MAIN, ...config } as MissionConfig, this.at()));
  }
  receipt(r: Partial<Receipt>): Receipt {
    const full: Receipt = { id: this.toolId(), tool: "read", at: this.at(), inputHash: "0".repeat(64), outputHash: "0".repeat(64), preview: "",
      isError: false, metrics: {}, asi: {}, links: [], ...r };
    this.add(makeEvent(this.state().mission!.id, "receipt_recorded", { receipt: full }, full.at));
    return full;
  }
  op(input: Record<string, unknown>): void {
    const p = prepareOperation(this.state(), input, `call-${++this.calls}`, MAIN, CWD, this.at());
    if (p.event) this.add(p.event);
  }
  evidence(e: { source: string; locator: string; title: string; claim: string; summary: string; stance?: string }, receiptId: string): string {
    this.op({ op: "evidence", evidence: { stance: "supports", ...e, receiptId } });
    return this.state().mission!.evidence.at(-1)!.id;
  }
  /** File evidence backed by a read that showed `shown` lines of `rel`. */
  file(rel: string, lines: [number, number], shown: number, e: { title: string; claim: string; summary: string; stance?: string }): string {
    const r = this.receipt({ tool: "read", opened: [rel], files: [{ path: `${CWD}/${rel}`, lines: [[1, shown]], complete: true }] });
    return this.evidence({ source: "file", locator: `${rel}:${lines[0]}-${lines[1]}`, ...e }, r.id);
  }
  listing(rels: string[], locator: string, e: { title: string; claim: string; summary: string; stance?: string }): string {
    const r = this.receipt({ tool: "glob", listed: rels.map(p => `${CWD}/${p}`) });
    return this.evidence({ source: "listing", locator, ...e }, r.id);
  }
  /** A harness run: `bash autoresearch.sh` output with METRIC lines; `crash` makes the tool result an error. */
  run(metrics: Record<string, number>, p: { label: string; hypothesis: string; crash?: boolean; checksPassed?: boolean; notes?: string }): { runId: string; receiptId: string } {
    const r = this.receipt({ tool: "bash", isError: !!p.crash, metrics, preview: Object.entries(metrics).map(([k, v]) => `METRIC ${k}=${v}`).join("\n") });
    this.op({ op: "run", run: { label: p.label, hypothesis: p.hypothesis, receiptId: r.id,
      ...(p.checksPassed !== undefined ? { checksPassed: p.checksPassed } : {}), ...(p.notes ? { notes: p.notes } : {}) } });
    return { runId: this.state().mission!.runs.at(-1)!.id, receiptId: r.id };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// License audit missions (A, B, C, E, F, I)

const PREFIX = ["acorn", "birch", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel", "lumen", "marble",
  "nectar", "onyx", "pylon", "quartz", "raven", "sable", "tundra", "umber", "vesper", "willow", "xenon", "yarrow", "zephyr"];
const SUFFIX = ["parse", "io", "cache", "codec", "log", "net", "fs", "crypto", "diff", "glob", "yaml", "toml", "uuid", "color", "retry",
  "queue", "stream", "lexer", "pool", "trace"];
const LICENSES = [
  { id: "MIT", name: "MIT License", w: 0.5 },
  { id: "Apache-2.0", name: "Apache License, Version 2.0", w: 0.25 },
  { id: "BSD-3-Clause", name: "BSD 3-Clause License", w: 0.15 },
  { id: "ISC", name: "ISC License", w: 0.1 },
] as const;
const AUTHORS = ["Mara Lindqvist", "Tomasz Wrona", "Aiko Tanabe", "Rafael Ortega", "Nadia Haddad", "Joon-ho Park", "Elena Petrova", "Kwame Mensah"];

interface Pkg { name: string; license: (typeof LICENSES)[number]; version: string; line: number; author: string; year: number }
function packages(b: Builder, n: number): Pkg[] {
  const names = PREFIX.flatMap(p => SUFFIX.map(s => `${p}-${s}`));
  // Deterministic shuffle so neighbouring items differ.
  for (let i = names.length - 1; i > 0; i--) { const j = b.int(0, i); [names[i], names[j]] = [names[j]!, names[i]!]; }
  return names.slice(0, n).map(name => {
    let x = b.int(0, 999) / 1000; const license = LICENSES.find(l => (x -= l.w) < 0) ?? LICENSES[0];
    return { name, license, version: `${b.int(0, 4)}.${b.int(0, 19)}.${b.int(0, 9)}`, line: b.int(3, 9), author: AUTHORS[b.int(0, AUTHORS.length - 1)]!, year: b.int(2016, 2026) };
  });
}
const PERMISSIVE = "MIT, Apache-2.0, BSD-3-Clause or ISC";
function auditObjective(n: number, extra = ""): string {
  return `Audit the ${n} vendored packages under vendor/ in this checkout: determine each package's declared license and whether every one of them is permissive (${PERMISSIVE}).${extra}`;
}
const AUDIT_DELIVERABLES = [
  "Per-package declared license for every vendored package, each backed by file evidence",
  "An overall determination of whether all vendored packages are permissively licensed",
];
const CONSTRAINTS = ["Research only; do not implement or modify product code.", "Use only files in this checkout; no network access."];

function inventory(b: Builder, pkgs: Pkg[]): string {
  const n = pkgs.length;
  return b.listing(pkgs.map(p => `vendor/${p.name}/package.json`), "vendor/", {
    title: "Inventory of vendored package manifests",
    claim: `vendor/ contains exactly ${n} vendored packages, each with a package.json manifest.`,
    summary: `glob vendor/*/package.json returned ${n} paths (vendor/${pkgs[0]!.name}/package.json … vendor/${pkgs.at(-1)!.name}/package.json); no other directories under vendor/ contain a manifest.`,
    stance: "context",
  });
}
function manifest(b: Builder, p: Pkg, long = false): string {
  const rel = `vendor/${p.name}/package.json`;
  if (!long) return b.file(rel, [p.line, p.line], 24, {
    title: `${p.name} package.json license field`,
    claim: `vendor/${p.name} declares the ${p.license.id} license in its package.json.`,
    summary: `Line ${p.line} of vendor/${p.name}/package.json reads "license": "${p.license.id}"; the manifest's version field is ${p.version}.`,
  });
  return b.file(rel, [1, 22], 24, {
    title: `${p.name} manifest, LICENSE header and source SPDX tags`,
    claim: `vendor/${p.name} (version ${p.version}) is distributed under the ${p.license.name} (SPDX ${p.license.id}): its package.json license field, the header of its LICENSE file and the SPDX identifiers in its source files all name ${p.license.id}, and no file in the package names a different or additional license.`,
    summary: [
      `vendor/${p.name}/package.json (lines 1-22) declares name "${p.name}", version "${p.version}", "license": "${p.license.id}" on line ${p.line}, author "${p.author}", and a repository URL under the vendor mirror.`,
      `The manifest has no "licenses" array and no "SEE LICENSE IN" indirection, so the SPDX expression ${p.license.id} is the whole declaration.`,
      `The LICENSE file shipped beside it starts with "${p.license.name}" followed by "Copyright (c) ${p.year} ${p.author}", matching the manifest author.`,
      `Every one of the package's JavaScript sources under src/ starts with the comment "// SPDX-License-Identifier: ${p.license.id}"; none carries a different identifier.`,
      `The README's "License" section repeats "${p.license.id}" and links to the same LICENSE file; there is no NOTICE file and no dual-licensing statement.`,
      `${p.license.id} is one of the permissive licenses named in the objective.`,
    ].join(" "),
  });
}
function auditNotes(n: number): string {
  return `Hypothesis: every vendored package is permissive. Plan: list vendor/*/package.json (${n} manifests), read each manifest's license field, `
    + `spot-check LICENSE headers where the manifest is ambiguous, then summarize per-package licenses. Next: if any package lacks a license field, `
    + `read its LICENSE file before concluding. Open question: whether bundled native code carries separate licenses (out of scope unless the objective asks).`;
}

function licenseCase(id: string, category: string, size: number, seed: number, mutate?: (b: Builder, pkgs: Pkg[]) => Plant[], opts: { long?: boolean; packages?: number; objectiveExtra?: string; deliverables?: string[] } = {}): Case {
  const b = new Builder(seed);
  const count = opts.packages ?? size - 1;
  const pkgs = packages(b, count);
  b.start({ objective: auditObjective(count, opts.objectiveExtra), mode: "data", constraints: CONSTRAINTS, deliverables: opts.deliverables ?? AUDIT_DELIVERABLES });
  inventory(b, pkgs);
  const plants = mutate ? mutate(b, pkgs) : (pkgs.forEach(p => manifest(b, p, opts.long)), []);
  b.op({ op: "notes", notes: auditNotes(count) });
  return { id, category, size, mission: b.mission(), entries: b.entries, expected: { assessment: plants.length ? "revise" : "pass", plants } };
}

/** E: one package's manifest says MIT while its LICENSE file is GPL-3.0. */
function contradiction(b: Builder, pkgs: Pkg[]): Plant[] {
  const at = Math.floor(pkgs.length * 0.6); const ids: string[] = [];
  pkgs.forEach((p, i) => {
    if (i !== at) { manifest(b, p); return; }
    const mit = { ...p, license: LICENSES[0] };
    ids.push(manifest(b, mit));
    ids.push(b.file(`vendor/${p.name}/LICENSE`, [1, 4], 40, {
      title: `${p.name} LICENSE file text`, stance: "contradicts",
      claim: `vendor/${p.name}'s LICENSE file contains the GNU General Public License version 3 text, not the MIT license its package.json declares.`,
      summary: `Lines 1-4 of vendor/${p.name}/LICENSE read "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007 / Copyright (C) 2007 Free Software Foundation"; the full GPL-3.0 text follows. GPL-3.0 is not one of the permissive licenses named in the objective.`,
    }));
  });
  return [{ kind: "contradiction", ids, note: `${pkgs[at]!.name}: package.json MIT vs LICENSE GPL-3.0` }];
}
/** F: a claim its own summary does not support, and a listing used as proof of file content. */
function unsupported(b: Builder, pkgs: Pkg[]): Plant[] {
  const a = Math.floor(pkgs.length * 0.3); const c = Math.min(pkgs.length - 1, Math.max(a + 1, Math.floor(pkgs.length * 0.7)));
  const plants: Plant[] = [];
  pkgs.forEach((p, i) => {
    if (i === a) {
      const id = b.file(`vendor/${p.name}/package.json`, [1, 14], 14, {
        title: `${p.name} package.json license field`,
        claim: `vendor/${p.name} declares the BSD-3-Clause license in its package.json.`,
        summary: `vendor/${p.name}/package.json (lines 1-14) has name, version "${p.version}", main and dependencies fields; it has no "license" field, and the package directory has no LICENSE or COPYING file.`,
      });
      plants.push({ kind: "unsupported", ids: [id], note: `${p.name}: claim BSD-3-Clause, summary says no license field` });
    } else if (i === c) {
      const id = b.listing([`vendor/${p.name}/LICENSE`], `vendor/${p.name}/LICENSE`, {
        title: `${p.name} LICENSE file`,
        claim: `vendor/${p.name} is licensed under Apache-2.0 according to its LICENSE file.`,
        summary: `glob vendor/*/LICENSE listed vendor/${p.name}/LICENSE.`,
      });
      plants.push({ kind: "unsupported", ids: [id], note: `${p.name}: listing evidence used as proof of LICENSE content` });
    } else manifest(b, p);
  });
  return plants;
}
/** I: the objective also asks for bundled native-library licenses; no evidence addresses them. */
function incomplete(b: Builder, pkgs: Pkg[]): Plant[] {
  pkgs.forEach(p => manifest(b, p));
  const natives = pkgs.slice(0, 3).map(p => `vendor/${p.name}/native/`);
  b.listing(natives.map(d => `${d}lib.c`), natives.join("; "), {
    title: "Packages that bundle native code", stance: "context",
    claim: `Three vendored packages bundle native code: ${natives.join(", ")}.`,
    summary: `glob vendor/*/native/** listed C sources only under ${natives.join(", ")}; no other package has a native/ directory.`,
  });
  return [{ kind: "incomplete", ids: [], keywords: ["native", "third-party", "bundled"], note: "native-library licenses deliverable has no evidence" }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Experiment missions (D, G, H)

const P95 = { name: "p95_ms", direction: "lower" as const };
interface Exp { b: Builder; runs: Record<string, { runId: string; receiptId: string; p95: number }> }
/** Three segments of parse-cache runs; `scale` multiplies the number of exploratory runs per segment. */
function experimentMission(seed: number, scale: number): Exp {
  const b = new Builder(seed);
  b.start({ mode: "data", constraints: [...CONSTRAINTS, "Product code changes only through PARSE_CACHE settings read by ./autoresearch.sh."], metric: P95,
    objective: "Determine whether enabling the parser's parse cache (PARSE_CACHE) lowers p95 parse latency on the fixed benchmark corpus without breaking the parser test suite, and which cache size to recommend.",
    deliverables: ["Baseline and best valid p95 latency per corpus segment, with the run IDs that produced them", "A recommended PARSE_CACHE size, or a statement that none is justified", "Whether the parser test suite still passes with the recommended setting"] });
  const runs: Exp["runs"] = {};
  const log = (key: string, p95: number, p: Parameters<Builder["run"]>[1], extra: Record<string, number> = {}) => {
    const metrics = { p95_ms: p95, p50_ms: Math.round(p95 * 0.55 * 10) / 10, rss_mb: 180 + b.int(0, 300), tests_passed: p.checksPassed === false ? 0 : 1, ...extra };
    runs[key] = { ...b.run(metrics, p), p95 };
  };
  const noise = (v: number) => Math.round((v + (b.int(0, 40) - 20) / 10) * 10) / 10;
  // Segment 0: 2,000-file corpus.
  log("s0_base", 142.0, { label: "cache off (baseline)", hypothesis: "Measure the 2,000-file corpus with PARSE_CACHE unset." });
  log("s0_64", 118.5, { label: "PARSE_CACHE=64MB", hypothesis: "A small cache removes repeated tokenization of shared headers." });
  log("s0_256_crash", 61.0, { label: "PARSE_CACHE=256MB", hypothesis: "A larger cache keeps every AST resident.", crash: true, notes: "OOM-killed after 400 of 2,000 files; p95 printed over the partial run" });
  log("s0_skip", 55.2, { label: "PARSE_CACHE=128MB, SKIP_VALIDATE=1", hypothesis: "Skipping AST validation removes a post-parse pass.", checksPassed: false, notes: "412 parser tests: 37 failed" });
  log("s0_128", 109.7, { label: "PARSE_CACHE=128MB", hypothesis: "128MB holds the hot set without memory pressure." });
  for (let i = 0; i < 4 * scale; i++) log(`s0_x${i}`, noise(112 + (i % 5) * 3), { label: `PARSE_CACHE=${96 + (i % 4) * 16}MB, eviction=${["lru", "lfu", "fifo"][i % 3]}`, hypothesis: `Eviction policy variant ${i + 1} keeps hot headers resident.` });
  log("s0_warm", 72.3, { label: "PARSE_CACHE=128MB (rerun)", hypothesis: "Repeat 128MB to confirm stability." });
  b.op({ op: "flag_run", runId: runs.s0_warm!.runId, reason: "Reused the warm on-disk cache left by the previous run; not a cold-start measurement of the fixed workload" });
  // Segment 1: corpus expanded, earlier runs incomparable.
  b.op({ op: "segment", segment: { reason: "Corpus expanded from 2,000 to 5,000 files to include generated sources; segment-0 latencies are not comparable", metric: P95 } });
  log("s1_base", 188.0, { label: "cache off (baseline, 5k corpus)", hypothesis: "Re-baseline on the 5,000-file corpus." });
  log("s1_128", 141.2, { label: "PARSE_CACHE=128MB (5k corpus)", hypothesis: "The segment-0 winner should transfer to the larger corpus." });
  log("s1_128b", 143.0, { label: "PARSE_CACHE=128MB repeat (5k corpus)", hypothesis: "Repeat to estimate noise." });
  for (let i = 0; i < 4 * scale; i++) log(`s1_x${i}`, noise(146 + (i % 6) * 2), { label: `PARSE_CACHE=${112 + (i % 3) * 16}MB, shards=${1 + (i % 4)}`, hypothesis: `Sharded cache variant ${i + 1} reduces lock contention.` });
  // Segment 2: throughput metric, higher is better.
  b.op({ op: "segment", segment: { reason: "Switch to files_per_s throughput on the 5,000-file corpus to check the cache does not trade throughput for tail latency", metric: { name: "files_per_s", direction: "higher" } } });
  const tput = (key: string, v: number, p: Parameters<Builder["run"]>[1]) => {
    const r = b.run({ files_per_s: v, tests_passed: 1 }, p); runs[key] = { ...r, p95: v };
  };
  tput("s2_base", 412, { label: "cache off (throughput)", hypothesis: "Throughput baseline." });
  tput("s2_128", 498, { label: "PARSE_CACHE=128MB (throughput)", hypothesis: "Cache should raise throughput too." });
  for (let i = 0; i < 2 * scale; i++) tput(`s2_x${i}`, 470 + (i % 5) * 4, { label: `PARSE_CACHE=128MB, workers=${2 + (i % 4)}`, hypothesis: `Worker count ${2 + (i % 4)} with cache.` });
  return { b, runs };
}
const EXP_NOTES = "Hypothesis: a 128MB parse cache lowers p95 without test regressions. Segment 0 ranked 128MB best among valid runs; 256MB crashed (OOM), "
  + "SKIP_VALIDATE broke 37 tests, and the warm rerun was flagged. Segment 1 re-baselined on 5k files. Segment 2 checks throughput. Next: write the recommendation.";
function experimentEvidence(x: Exp, plant?: "incorrect" | "invalid"): Plant[] {
  const { b, runs } = x; const r = runs;
  const ev = (key: string, e: { title: string; claim: string; summary: string; stance?: string }) =>
    b.evidence({ source: "experiment", locator: `bash autoresearch.sh (run ${r[key]!.runId})`, ...e }, r[key]!.receiptId);
  ev("s0_base", { title: "Segment 0 baseline", claim: `With PARSE_CACHE unset, p95 parse latency on the 2,000-file corpus is 142.0 ms (run ${r.s0_base!.runId}).`,
    summary: `autoresearch.sh printed METRIC p95_ms=142.0 and tests_passed=1 for the cache-off run ${r.s0_base!.runId}, the first valid run of segment 0.` });
  const plants: Plant[] = [];
  if (plant === "incorrect") {
    const id = ev("s0_128", { title: "128MB cache result (segment 0)", claim: `PARSE_CACHE=128MB lowered p95 by 35%, from 142.0 ms to 92.3 ms (run ${r.s0_128!.runId}).`,
      summary: `Run ${r.s0_128!.runId} with PARSE_CACHE=128MB completed with tests_passed=1 against the segment-0 baseline ${r.s0_base!.runId}.` });
    plants.push({ kind: "invalid_run", ids: [id, r.s0_128!.runId], note: "misreported metric: run measured 109.7 ms (-22.7%), claim says 92.3 ms (-35%)" });
    const id2 = ev("s1_128", { title: "Cache on the 5k corpus", claim: `On the 5,000-file corpus PARSE_CACHE=128MB reached 141.2 ms (run ${r.s1_128!.runId}), beating the 142.0 ms cache-off baseline of run ${r.s0_base!.runId}.`,
      summary: `Run ${r.s1_128!.runId} printed METRIC p95_ms=141.2 on the expanded corpus.` });
    plants.push({ kind: "invalid_run", ids: [id2], note: "cross-segment comparison against an incomparable baseline" });
  } else {
    ev("s0_128", { title: "128MB cache result (segment 0)", claim: `PARSE_CACHE=128MB lowered p95 from 142.0 ms to 109.7 ms (-22.7%) on the 2,000-file corpus (run ${r.s0_128!.runId}); it is the best valid run of segment 0.`,
      summary: `Run ${r.s0_128!.runId} printed METRIC p95_ms=109.7 and tests_passed=1; lower crashed, failed-check and flagged runs are excluded.` });
    ev("s1_128", { title: "Cache on the 5k corpus", claim: `On the 5,000-file corpus PARSE_CACHE=128MB lowered p95 from 188.0 ms (run ${r.s1_base!.runId}) to 141.2 ms (run ${r.s1_128!.runId}); a repeat measured 143.0 ms (run ${r.s1_128b!.runId}).`,
      summary: `Segment 1 baseline ${r.s1_base!.runId} printed p95_ms=188.0; ${r.s1_128!.runId} printed 141.2 and ${r.s1_128b!.runId} 143.0, both with tests_passed=1.` });
  }
  if (plant === "invalid") {
    const id = ev("s0_256_crash", { title: "256MB cache result", claim: `PARSE_CACHE=256MB achieved the best p95 of all configurations, 61.0 ms (run ${r.s0_256_crash!.runId}), a 57% reduction.`,
      summary: `Run ${r.s0_256_crash!.runId} printed METRIC p95_ms=61.0 with PARSE_CACHE=256MB.` });
    plants.push({ kind: "invalid_run", ids: [id, r.s0_256_crash!.runId], note: "best result taken from a crashed run" });
    const id2 = ev("s0_warm", { title: "128MB rerun", claim: `The 128MB rerun (run ${r.s0_warm!.runId}) confirms PARSE_CACHE=128MB at 72.3 ms p95, the best valid result of segment 0.`,
      summary: `Run ${r.s0_warm!.runId} printed METRIC p95_ms=72.3 and tests_passed=1.` });
    plants.push({ kind: "invalid_run", ids: [id2, r.s0_warm!.runId], note: "flagged warm-cache rerun treated as valid best" });
  }
  ev("s2_128", { title: "Throughput with cache", claim: `With PARSE_CACHE=128MB throughput rose from 412 to 498 files/s on the 5,000-file corpus (runs ${r.s2_base!.runId}, ${r.s2_128!.runId}).`,
    summary: `Segment 2 (files_per_s, higher is better) baseline ${r.s2_base!.runId} printed files_per_s=412; ${r.s2_128!.runId} printed 498.` });
  const tests = b.receipt({ tool: "read", opened: ["results/parser-tests.txt"], files: [{ path: `${CWD}/results/parser-tests.txt`, lines: [[1, 6]], complete: true }] });
  b.evidence({ source: "experiment", locator: "results/parser-tests.txt:1-6", title: "Parser test suite with PARSE_CACHE=128MB",
    claim: "With PARSE_CACHE=128MB all 412 parser tests pass.", summary: "results/parser-tests.txt lines 1-6: \"PARSE_CACHE=128MB\", \"412 tests, 412 passed, 0 failed\"." }, tests.id);
  ev("s0_256_crash", { title: "Excluded runs", stance: "context",
    claim: `Runs ${r.s0_256_crash!.runId} (256MB, crashed), ${r.s0_skip!.runId} (SKIP_VALIDATE, 37 failed tests) and ${r.s0_warm!.runId} (flagged warm rerun) are excluded from best-result reasoning.`,
    summary: `${r.s0_256_crash!.runId} was OOM-killed; ${r.s0_skip!.runId} logged checks_failed; ${r.s0_warm!.runId} was flagged for reusing a warm cache.` });
  b.op({ op: "notes", notes: EXP_NOTES });
  return plants;
}
function experimentCase(id: string, category: string, seed: number, scale: number, plant?: "incorrect" | "invalid"): Case {
  const x = experimentMission(seed, scale);
  const plants = experimentEvidence(x, plant);
  const mission = x.b.mission();
  return { id, category, size: mission.runs.length, mission, entries: x.b.entries, expected: { assessment: plants.length ? "revise" : "pass", plants } };
}

/** The frozen suite. Order and seeds are part of the fixture; `fixtures.lock.json` pins their hashes. */
export function buildCases(): Case[] {
  const SIZES = [5, 25, 100, 500];
  return [
    licenseCase("A-small-clean-5", "A small evidence set", 5, 101),
    ...SIZES.slice(1).map(n => licenseCase(`B-large-clean-${n}`, "B large evidence set", n, 200 + n)),
    licenseCase("C-long-text-25", "C long claims and summaries", 25, 301, undefined, { long: true }),
    experimentCase("D-experiments-20", "D segments and runs", 401, 1),
    experimentCase("D-experiments-120", "D segments and runs", 402, 8),
    ...SIZES.map(n => licenseCase(`E-contradiction-${n}`, "E contradictory evidence", n, 500 + n, contradiction, { packages: n - 2 })),
    ...SIZES.map(n => licenseCase(`F-unsupported-${n}`, "F unsupported or fabricated claims", n, 600 + n, unsupported)),
    experimentCase("G-incorrect-conclusion", "G incorrect experimental conclusions", 701, 1, "incorrect"),
    experimentCase("H-invalid-runs", "H flagged or crashed runs", 801, 1, "invalid"),
    licenseCase("I-incomplete-25", "I incomplete deliverables", 25, 901, incomplete, { packages: 23,
      objectiveExtra: " For the packages that bundle native code, also determine the licenses of the third-party native libraries they bundle.",
      deliverables: [...AUDIT_DELIVERABLES, "Licenses of the third-party native libraries bundled by vendored packages"] }),
  ];
}
/** Hash of everything a case fixes: the reviewed mission state and the reference judgment. Mission/pass/event IDs are random and excluded. */
export function caseHash(c: Case): string {
  const m = c.mission;
  return hash({ id: c.id, expected: c.expected, objective: m.objective, mode: m.mode, constraints: m.constraints, deliverables: m.deliverables,
    evidence: m.evidence, runs: m.runs, segments: m.segments, notes: m.notes });
}
