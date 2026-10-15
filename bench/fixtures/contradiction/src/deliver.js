export async function deliver(target, body, { timeoutMs, maxRetries }) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(target, { method: "POST", body, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return 202;
    } catch {}
    await new Promise(r => setTimeout(r, 2 ** attempt * 100));
  }
  return 502;
}
