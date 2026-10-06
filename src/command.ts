import { DEFAULT_SETTINGS, validateConfig, validateSettings } from "./engine.ts";
import type { MissionConfig, MissionSettings } from "./types.ts";
import { ResearchError } from "./validation.ts";
export type Command =
  | { op: "start"; config: MissionConfig }
  | { op: "intake"; draft: string; settings: MissionSettings }
  | { op: "help" | "status" | "resume" | "pause" | "cancel" | "clear" | "export" };
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
/** `--mode` is the explicit, zero-question path; without it the command opens a clarifying intake. Mode is never inferred. */
export function parseCommand(args: string, primaryModel?: string): Command {
  const tokens = tokenize(args);
  if (!tokens.length) return { op: "help" };
  const simple = ["help", "status", "resume", "pause", "cancel", "clear", "export"] as const;
  if (simple.includes(tokens[0] as typeof simple[number])) {
    if (tokens.length !== 1) throw new ResearchError(`${tokens[0]} does not accept arguments`);
    return { op: tokens[0] as typeof simple[number] };
  }
  if (tokens[0] === "start") tokens.shift();
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (primaryModel) settings.primaryModel = primaryModel;
  let mode: string | undefined;
  const objective: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--") { objective.push(...tokens.slice(i + 1)); break; }
    if (t === "--allow-exec") { settings.allowExec = true; continue; }
    if (t === "--harness") { settings.allowHarness = true; continue; }
    if (!t.startsWith("--")) { objective.push(t); continue; }
    const key = t; const v = tokens[++i];
    if (!v || v.startsWith("--")) throw new ResearchError(`Missing value for ${key}`);
    switch (key) {
      case "--mode": mode = v; break;
      case "--budget": settings.maxContinuations = Number(v); break;
      case "--max-tools": settings.maxToolCalls = Number(v); break;
      case "--max-minutes": settings.maxMinutes = Number(v); break;
      case "--critic": settings.criticModel = v; break;
      case "--constraint": settings.constraints.push(v); break;
      case "--deliverable": settings.deliverables.push(v); break;
      default: throw new ResearchError(`Unknown option: ${key}`);
    }
  }
  if (mode === undefined) return { op: "intake", draft: objective.join(" "), settings: validateSettings(settings) };
  return { op: "start", config: validateConfig({ ...settings, mode, objective: objective.join(" ") }) };
}
export const HELP = `Deep Research (Gajae-inspired, not OMP's native /autoresearch)
/deep-research <objective>              clarifying intake, then the agent starts the mission
/deep-research --mode web|data|mixed <objective>   start immediately with an explicit mode
/deep-research --mode data --harness <objective>   allow ./autoresearch.sh benchmark harness
/deep-research status | pause | resume | cancel | clear | export
Options: --budget 0..8 (default 6); --max-tools 1..1000 (default 60);
--max-minutes 1..240 (default 20); --critic provider/model;
--constraint "..."; --deliverable "...".
Execution is OFF by default. --harness (data/mixed) allows writing only
./autoresearch.sh and running exactly \`bash autoresearch.sh\`; the harness
itself is arbitrary code. --allow-exec (data/mixed) authorizes any bash/eval.
Neither is a sandbox. Mode is never inferred from files.
Clear retires the mission but never deletes its append-only session history.
Resume starts a new bounded pass and preserves evidence and past verdicts.`;
