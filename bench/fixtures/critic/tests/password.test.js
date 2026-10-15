import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/password.js";

test("round trip", () => {
  const stored = hashPassword("hunter2");
  assert.match(stored, /^pbkdf2_sha256\$600000\$/);
  assert.equal(verifyPassword("hunter2", stored), true);
});
