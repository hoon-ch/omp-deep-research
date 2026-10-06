import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("../scripts/publish-github.sh", import.meta.url));
test("publish script is syntactically valid", () => {
  assert.equal(spawnSync("bash", ["-n", script], { encoding: "utf8" }).status, 0);
});
test("publish dry-run defaults to private, does not invoke GitHub", () => {
  const r = spawnSync("bash", [script, "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0); assert.match(r.stdout, /Visibility: --private/); assert.match(r.stdout, /hoon-ch\/omp-deep-research/);
});
test("public visibility must be explicit", () => {
  const r = spawnSync("bash", [script, "--public", "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0); assert.match(r.stdout, /Visibility: --public/);
});
test("publish helper refuses unknown arguments before external actions", () => {
  const r = spawnSync("bash", [script, "--force"], { encoding: "utf8" }); assert.equal(r.status, 2);
});
