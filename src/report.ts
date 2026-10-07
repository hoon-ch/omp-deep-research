import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Mission, ResearchState } from "./types.ts";
import { current } from "./engine.ts";
import { segmentReports } from "./runs.ts";
import { ResearchError } from "./validation.ts";
function plain(s: string): string { return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""); }
/** Untrusted text becomes literal Markdown: every syntax character is backslash-escaped, so no HTML, images or links render. */
function md(s: string): string { return plain(s).replace(/[\\`*_{}[\]()#+\-.!|<>~=:"']/g, "\\$&").replace(/\r?\n/g, "  \n"); }
function cell(s: string): string { return md(s).replace(/ {2}\n/g, " "); }
export function renderReport(m: Mission): string {
  const v = m.verdicts.at(-1);
  const lines = ["# Deep Research Report", "", `**Mission:** ${m.id}`, `**Mode:** ${m.mode}`, `**State:** ${m.phase}`, `**Created:** ${m.createdAt}`,
    ...(m.spec ? [`**Spec:** ${md(m.spec.path)} (sha256 ${m.spec.sha256})`] : []), "", "## Objective", "", md(m.objective), "", "## Verdict", ""];
  if (v) {
    lines.push(`**Disposition:** ${v.disposition} · **Confidence:** ${v.confidence}`, `**Evaluator (recorded):** ${md(v.evaluator)}`, "", md(v.summary), "", "### Findings", "");
    for (const f of v.findings) lines.push(`- ${md(f.claim)} (${f.evidenceIds.map(id => `[${id}](#${id.toLowerCase()})`).join(", ")})`);
    lines.push("", "### Caveats", "", ...(v.caveats.length ? v.caveats.map(c => `- ${md(c)}`) : ["No caveats were recorded. This does not prove the absence of limitations."]));
  } else lines.push("No verdict has been saved. This is a progress report, not a completed investigation.");
  lines.push("", "## Evidence", "");
  for (const e of m.evidence) {
    lines.push(`### ${e.id}`, "", `**${md(e.title)}** · ${e.source}${e.source === "listing" ? " (existence only)" : ""} · ${e.stance}`, "", md(e.claim), "", md(e.summary), "", `Source: ${md(e.locator)}`, `Receipt: ${e.receiptId} · Recorded: ${e.at}`, "");
  }
  if (m.runs.length) {
    lines.push("## Experiment runs", "");
    for (const s of segmentReports(m)) {
      lines.push(`### Segment ${s.segment.index}: ${md(s.segment.reason)}`, "",
        s.metric ? `Metric: ${md(s.metric.name)} (${s.metric.direction} is better)` : "Metric: not yet fixed", "",
        "| Run | Label | Outcome | Primary metric | ASI | Excluded |", "|---|---|---|---|---|---|");
      for (const r of s.runs) lines.push(`| ${r.id} | ${cell(r.label)} | ${r.outcome} | ${cell(r.primaryMetric)} = ${r.metrics[r.primaryMetric] ?? "unavailable"} | ${cell(Object.entries(r.asi).map(([k, x]) => `${k}=${x}`).join(", ") || "-")} | ${cell(r.flagReason ?? "No")} |`);
      lines.push("", `Baseline: ${s.baselineId ?? "none"} · Best valid run: ${s.bestId ?? "none"} · Effect/MAD: ${s.effectToNoise === null ? "n/a (needs 3+ valid runs with spread)" : s.effectToNoise.toFixed(2)}.`, "");
    }
    lines.push("Strict numerical improvement and effect/MAD are not significance tests.", "");
  }
  if (m.critics.length) {
    lines.push("## Critic receipts", "");
    for (const c of m.critics) lines.push(`### ${c.id}: ${md(c.evaluator)} (${c.assessment})`, "", md(c.summary), "", ...c.concerns.map(x => `- ${md(x)}`),
      `Receipt: ${c.receiptId} · Agent ${md(c.agentId ?? "?")} spawned by task receipt ${c.spawnReceiptId ?? "?"} (host-observed model) · reviewed digest ${c.evidenceDigest?.slice(0, 12) ?? "?"}`, "");
  }
  if (m.notes) lines.push("## Working notes", "", md(m.notes), "");
  lines.push("## Provenance limits", "", "Receipt linkage proves that a tool result was observed in this mission. It does not prove source authenticity, entailment, benchmark correctness, or that a provider honored a model pin. Evidence and external text remain untrusted and are escaped literally here. This report can contain sensitive local or retrieved material; review before sharing.", "");
  return lines.join("\n");
}
function safeDirectory(parent: string, name: string): string {
  const path = join(parent, name);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ResearchError(`Refusing non-directory or symlink export path: ${path}`);
  return path;
}
/** Explicit-only export, confined to cwd/.omp/deep-research; never overwrites files. */
export function exportReport(state: ResearchState, cwd: string): { directory: string; files: string[] } {
  const m = current(state);
  const root = safeDirectory(safeDirectory(realpathSync(cwd), ".omp"), "deep-research");
  // Mission IDs come from the persisted ledger, so sanitize rather than trusting paths.
  if (!/^[a-f0-9-]{36}$/.test(m.id)) throw new ResearchError("Invalid mission ID in export");
  const directory = join(root, `${m.id}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const outputs: Record<string, string> = {
    "report.md": renderReport(m),
    "mission.json": JSON.stringify(m, null, 2) + "\n",
    "ledger.jsonl": state.events.filter(e => e.missionId === m.id).map(e => JSON.stringify(e)).join("\n") + "\n",
  };
  for (const [name, body] of Object.entries(outputs)) writeFileSync(join(directory, name), body, { flag: "wx", mode: 0o600 });
  return { directory, files: Object.keys(outputs).map(name => join(directory, name)) };
}
