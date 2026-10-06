import { DEFAULT_CONFIG, validateConfig } from "./engine.ts";
import type { MissionConfig } from "./types.ts";
import { ResearchError } from "./validation.ts";
export type Command = { op: "start"; config: MissionConfig } | { op: "help" | "status" | "resume" | "pause" | "cancel" | "clear" | "export" };
/** Tokenizes command arguments; never evaluates shell syntax. */
export function tokenize(input: string): string[] {
  const out: string[] = []; let token = ""; let quote = ""; let escaped = false; let started = false;
  for (const c of input) {
    if (escaped) { token += c; escaped = false; started = true; continue; }
    if (c === "\\" && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (c === quote) quote = ""; else token += c; started = true; continue; }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) out.push(token); token = ""; started = false; }
    else { token += c; started = true; }
  }
  if (quote || escaped) throw new ResearchError("Unterminated quote or trailing escape in command");
  if (started) out.push(token);
  return out;
}
export function parseCommand(args: string, primaryModel?: string): Command {
  const tokens = tokenize(args);
  if (!tokens.length) return { op: "help" };
  const simple = ["help", "status", "resume", "pause", "cancel", "clear", "export"] as const;
  if (simple.includes(tokens[0] as typeof simple[number])) {
    if (tokens.length !== 1) throw new ResearchError(`${tokens[0]} does not accept arguments`);
    return { op: tokens[0] as typeof simple[number] };
  }
  if (tokens[0] === "start") tokens.shift();
  const config = structuredClone(DEFAULT_CONFIG) as MissionConfig;
  if (primaryModel) config.primaryModel = primaryModel;
  const objective: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--") { objective.push(...tokens.slice(i + 1)); break; }
    if (t === "--allow-exec") { config.allowExec = true; continue; }
    if (!t.startsWith("--")) { objective.push(t); continue; }
    const key = t; const v = tokens[++i];
    if (!v || v.startsWith("--")) throw new ResearchError(`Missing value for ${key}`);
    switch (key) {
      case "--mode": config.mode = v as MissionConfig["mode"]; break;
      case "--budget": config.maxContinuations = Number(v); break;
      case "--max-tools": config.maxToolCalls = Number(v); break;
      case "--max-minutes": config.maxMinutes = Number(v); break;
      case "--critic": config.criticModel = v; break;
      case "--constraint": config.constraints.push(v); break;
      case "--deliverable": config.deliverables.push(v); break;
      default: throw new ResearchError(`Unknown option: ${key}`);
    }
  }
  config.objective = objective.join(" ");
  return { op: "start", config: validateConfig(config) };
}
export const HELP = `Deep Research (Gajae-inspired, not OMP's native /autoresearch)
/deep-research --mode web <objective>
/deep-research --mode mixed --allow-exec <objective>
/deep-research status | pause | resume | cancel | clear | export
Options: --mode web|data|mixed; --budget 0..8 (default 6);
--max-tools 1..1000 (default 60); --max-minutes 1..240 (default 20);
--critic provider/model; --constraint "..."; --deliverable "...".
Default mode: web. Execution is OFF. --allow-exec authorizes arbitrary
bash/eval execution in data/mixed mode; it is NOT a sandbox.
Clear retires the mission but never deletes its append-only session history.
Resume starts a new bounded pass and preserves evidence and past verdicts.`;
