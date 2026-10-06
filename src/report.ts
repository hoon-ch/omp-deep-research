import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Mission, ResearchState } from "./types.ts";
import { bestRun, current } from "./engine.ts";
import { ResearchError } from "./validation.ts";
function plain(s: string): string { return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""); }
function cell(s: string): string { return plain(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }
export function renderReport(m: Mission): string {
  const v = m.verdicts.at(-1); const best = bestRun(m);
  const lines = ["# Deep Research Report", "", `**Mission:** ${m.id}`, `**Mode:** ${m.mode}`, `**State:** ${m.phase}`, `**Created:** ${m.createdAt}`, "", "## Objective", "", plain(m.objective), "", "## Verdict", ""];
  if (v) {
    lines.push(`**Disposition:** ${v.disposition} · **Confidence:** ${v.confidence}`, `**Evaluator (recorded):** ${plain(v.evaluator)}`, "", plain(v.summary), "", "### Findings", "");
    for (const f of v.findings) lines.push(`- ${plain(f.claim)} (${f.evidenceIds.map(id => `[${id}](#${id.toLowerCase()})`).join(", ")})`);
    lines.push("", "### Caveats", "", ...(v.caveats.length ? v.caveats.map(c => `- ${plain(c)}`) : ["No caveats were recorded. This does not prove the absence of limitations."]));
  } else lines.push("No verdict has been saved. This is a progress report, not a completed investigation.");
  lines.push("", "## Evidence", "");
  for (const e of m.evidence) {
    lines.push(`### ${e.id}`, "", `**${plain(e.title)}** · ${e.stance}`, "", plain(e.claim), "", plain(e.summary), "", `Source: ${plain(e.locator)}`, `Receipt: ${e.receiptId} · Recorded: ${e.at}`, "");
  }
  if (m.runs.length) {
    lines.push("## Experiment runs", "", "| Run | Label | Outcome | Primary metric | Excluded |", "|---|---|---|---|---|");
    for (const r of m.runs) lines.push(`| ${r.id} | ${cell(r.label)} | ${r.outcome} | ${cell(r.primaryMetric)} = ${r.metrics[r.primaryMetric] ?? "unavailable"} | ${cell(r.flagReason ?? "No")} |`);
    lines.push("", `Best valid run: ${best?.id ?? "none"}. Strict numerical improvement is not a significance test.`, "");
  }
  if (m.critics.length) {
    lines.push("## Critic receipts", "");
    for (const c of m.critics) lines.push(`### ${c.id}: ${plain(c.evaluator)} (${c.assessment})`, "", plain(c.summary), "", ...c.concerns.map(x => `- ${plain(x)}`), `Receipt: ${c.receiptId}`, "");
  }
  if (m.notes) lines.push("## Working notes", "", plain(m.notes), "");
  lines.push("## Provenance limits", "", "Receipt linkage proves that a tool result was observed in this mission. It does not prove source authenticity, entailment, benchmark correctness, or independent reviewer identity. Evidence and external text remain untrusted. This report can contain sensitive local or retrieved material; review before sharing.", "");
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
