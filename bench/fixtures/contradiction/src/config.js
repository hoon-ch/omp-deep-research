const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const DEFAULTS = Object.freeze({
  port: 8080,
  timeoutMs: 60_000,
  maxRetries: 5,
});

export function loadConfig(env = process.env) {
  return {
    port: int(env.RELAY_PORT, DEFAULTS.port),
    timeoutMs: int(env.RELAY_TIMEOUT_MS, DEFAULTS.timeoutMs),
    maxRetries: int(env.RELAY_MAX_RETRIES, DEFAULTS.maxRetries),
  };
}
