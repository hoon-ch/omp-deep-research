import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// OWASP 2023 guidance for PBKDF2-HMAC-SHA256.
const ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2_${DIGEST}$${ITERATIONS}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, iterations, salt, key] = stored.split("$");
  if (scheme !== `pbkdf2_${DIGEST}`) return false;
  const expected = Buffer.from(key, "base64");
  const actual = pbkdf2Sync(password, Buffer.from(salt, "base64"), Number(iterations), expected.length, DIGEST);
  return timingSafeEqual(actual, expected);
}
