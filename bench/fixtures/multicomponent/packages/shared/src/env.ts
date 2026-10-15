/** Reads an environment variable, falling back to `fallback` when it is unset or empty. */
export function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Reads a required environment variable. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
