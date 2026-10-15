import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Segment 1 pins the main model that actually delegated in the preflight. A model change needs a new baseline.
const [model, thinking] = (process.env.BENCH_MAIN ?? "openai-codex/gpt-6.1-sol:high").split(":");
export const MAIN_MODEL = model!;
export const MAIN_THINKING = thinking ?? "medium";
export const OVERLAY = resolve(import.meta.dirname, "omp-overlay.yml");

export interface MissionRun { settled: boolean; timedOut: boolean; exitCode: number | null; wallMs: number; sessionFile?: string; stderr: string; errors: string[] }

/**
 * Runs one `/deep-research` command headless (`omp --mode rpc --no-ui`) and waits for the session to settle after the
 * mission's agent work. Usage is read afterwards from the session files, not from these frames.
 */
export function runMission(opts: { cwd: string; sessionDir: string; prompt: string; timeoutMs: number }): Promise<MissionRun> {
  const started = Date.now();
  const child = spawn("omp", ["--mode", "rpc", "--no-ui", "--no-title", "--config", OVERLAY, "--model", MAIN_MODEL, "--thinking", MAIN_THINKING,
    "--cwd", opts.cwd, "--session-dir", opts.sessionDir], { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PI_NO_TITLE: "1" } });
  const { promise, resolve: done } = Promise.withResolvers<MissionRun>();
  let buffer = ""; let stderr = ""; let agentRuns = 0; let settled = false; let timedOut = false; let sessionFile: string | undefined;
  const errors: string[] = [];
  const send = (frame: unknown) => { if (child.stdin.writable) child.stdin.write(`${JSON.stringify(frame)}\n`); };
  const finish = () => { if (child.stdin.writable) child.stdin.end(); };
  const timer = setTimeout(() => { timedOut = true; send({ id: "abort", type: "abort" }); setTimeout(() => child.kill("SIGTERM"), 15_000); finish(); }, opts.timeoutMs);
  const onFrame = (f: Record<string, unknown>) => {
    if (f.type === "ready") send({ id: "prompt", type: "prompt", message: opts.prompt });
    else if (f.type === "prompt_result" && f.agentInvoked === false && !settled) {
      settled = true; send({ id: "state", type: "get_state" });
    }
    else if (f.type === "agent_start") agentRuns++;
    else if (f.type === "extension_error") errors.push(`extension_error ${String(f.event)}: ${String(f.error)}`);
    else if (f.type === "response" && f.success === false) errors.push(`${String(f.command)}: ${String(f.error)}`);
    else if (f.type === "response" && f.id === "state") {
      const data = f.data as Record<string, unknown> | undefined;
      if (typeof data?.sessionFile === "string") sessionFile = data.sessionFile;
      finish();
    } else if (f.type === "session_settled" && agentRuns > 0 && !settled && !timedOut) { settled = true; send({ id: "state", type: "get_state" }); }
  };
  child.stderr.on("data", d => { stderr += String(d); if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
  child.stdout.on("data", d => {
    buffer += String(d);
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try { onFrame(JSON.parse(line) as Record<string, unknown>); } catch { /* non-JSON stdout noise */ }
    }
  });
  child.on("close", code => { clearTimeout(timer); done({ settled, timedOut, exitCode: code, wallMs: Date.now() - started, sessionFile, stderr, errors }); });
  return promise;
}
