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
