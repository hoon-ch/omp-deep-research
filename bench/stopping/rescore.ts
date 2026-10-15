/**
 * Re-scores saved runs with the current scorer, so every label is compared under the same rules.
 *
 *   node --experimental-strip-types bench/stopping/rescore.ts <label> [<label>…]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, scoreRun, type Case, type RunScore } from "./score.ts";

const BENCH = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(BENCH, "cases.json"), "utf8")) as { cases: Case[] };
for (const label of process.argv.slice(2)) {
  const dir = join(BENCH, "results", "live", label);
  const runs: RunScore[] = readdirSync(dir).filter(f => /^C\d+-r\d+\.json$/.test(f)).map(f => {
    const saved = JSON.parse(readFileSync(join(dir, f), "utf8")) as RunScore & { sessionDir: string };
    const c = suite.cases.find(x => x.id === saved.case)!;
    const score = scoreRun(c, saved.rep, join(dirname(saved.sessionDir), "ws"), saved.sessionDir, saved.wallMs, saved.exit);
    writeFileSync(join(dir, f), JSON.stringify({ ...score, sessionDir: saved.sessionDir }, null, 2));
    return score;
  }).sort((a, b) => a.case.localeCompare(b.case) || a.rep - b.rep);
  const previous = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  const summary = aggregate(runs);
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...previous, summary, runs }, null, 2));
  console.log(label, JSON.stringify(summary));
}
