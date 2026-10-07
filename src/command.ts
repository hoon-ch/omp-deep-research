import { DEFAULT_SETTINGS, validateConfig, validateMetric, validateSettings } from "./engine.ts";
import type { ParsedSpec } from "./spec.ts";
import type { MissionConfig, MissionSettings, Mode, SpecSource } from "./types.ts";
import { choice, hash, ResearchError } from "./validation.ts";
const MODES = ["web", "data", "mixed"] as const;
export type Command =
  | { op: "start"; config: MissionConfig }
  | { op: "intake"; draft: string; settings: MissionSettings }
  | { op: "spec"; path: string; mode?: Mode; settings: MissionSettings }
  | { op: "mode"; mode: Mode }
  | { op: "help" | "status" | "runs" | "resume" | "pause" | "cancel" | "clear" | "export" | "reset-ledger" };
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
/** `--mode` or `--spec` is the explicit, zero-question path; otherwise the command opens a clarifying intake. Mode is never inferred. */
export function parseCommand(args: string, primaryModel?: string): Command {
  const tokens = tokenize(args);
  if (!tokens.length) return { op: "help" };
  const simple = ["help", "status", "runs", "resume", "pause", "cancel", "clear", "export", "reset-ledger"] as const;
  if (simple.includes(tokens[0] as typeof simple[number])) {
    if (tokens.length !== 1) throw new ResearchError(`${tokens[0]} does not accept arguments`);
    return { op: tokens[0] as typeof simple[number] };
  }
  if (tokens[0] === "mode") {
    if (tokens.length !== 2) throw new ResearchError("Usage: /deep-research mode web|data|mixed");
    return { op: "mode", mode: choice(tokens[1], MODES, "mode") };
  }
  if (tokens[0] === "start") tokens.shift();
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (primaryModel) settings.primaryModel = primaryModel;
  let mode: string | undefined; let spec: string | undefined; let metric: string | undefined; let direction: string | undefined;
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
      case "--spec": spec = v; break;
      case "--metric": metric = v; break;
      case "--direction": direction = v; break;
      case "--budget": settings.maxContinuations = Number(v); break;
      case "--max-tools": settings.maxToolCalls = Number(v); break;
      case "--max-children": settings.maxChildren = Number(v); break;
      case "--max-tokens": settings.maxTokens = Number(v); break;
      case "--max-cost": settings.maxCost = Number(v); break;
      case "--max-minutes": settings.maxMinutes = Number(v); break;
      case "--critic": settings.criticModel = v; break;
      case "--constraint": settings.constraints.push(v); break;
      case "--deliverable": settings.deliverables.push(v); break;
      default: throw new ResearchError(`Unknown option: ${key}`);
    }
  }
  if ((metric === undefined) !== (direction === undefined)) throw new ResearchError("--metric and --direction must be given together");
  if (metric !== undefined) settings.metric = validateMetric({ name: metric, direction }, "--metric");
  if (spec !== undefined) {
    if (objective.length) throw new ResearchError("--spec takes the objective from the spec file; remove the extra objective text");
    return { op: "spec", path: spec, ...(mode !== undefined ? { mode: choice(mode, MODES, "mode") } : {}), settings: validateSettings(settings) };
  }
  if (mode === undefined) return { op: "intake", draft: objective.join(" "), settings: validateSettings(settings) };
  return { op: "start", config: validateConfig({ ...settings, mode, objective: objective.join(" ") }) };
}
/** Merges a parsed spec with command flags. Flags may add constraints/deliverables but cannot contradict the spec's mode or metric. */
export function specConfig(spec: ParsedSpec, settings: MissionSettings, source: SpecSource, mode?: Mode): MissionConfig {
  if (mode && mode !== spec.mode) throw new ResearchError(`--mode ${mode} contradicts the spec's declared mode ${spec.mode}`);
  if (settings.metric && spec.metric && hash(settings.metric) !== hash(spec.metric)) throw new ResearchError("--metric/--direction contradict the spec's declared metric");
  const metric = settings.metric ?? spec.metric;
  return validateConfig({ ...settings, objective: spec.objective, mode: spec.mode, spec: source, ...(metric ? { metric } : {}),
    constraints: [...new Set([...settings.constraints, ...spec.constraints])],
    deliverables: [...new Set([...settings.deliverables, ...spec.deliverables])] });
}
export const HELP = `Deep Research (Gajae-inspired, not OMP's native /autoresearch)
/deep-research <objective>                    clarifying intake, then the agent starts the mission
/deep-research --mode web|data|mixed <objective>   start immediately with an explicit mode
/deep-research --spec <file.md>                start from a written spec (declares deep-research-mode:)
/deep-research --mode data --harness <objective>   allow the ./autoresearch.sh benchmark harness
/deep-research status | runs | pause | resume | cancel | clear | export
/deep-research mode web|data|mixed             change an open mission's mode
/deep-research reset-ledger                    retire an unreadable research ledger
Options: --budget 0..8 (default 6); --max-tools 1..1000 (default 60);
--max-children 0..32 subagents per pass (default 8);
--max-minutes 1..240 (default 20); --max-tokens N; --max-cost USD (both include subagents);
--critic provider/model; --metric <name> --direction lower|higher;
--constraint "..."; --deliverable "...".
Execution is OFF by default. --harness (data/mixed) allows writing only
./autoresearch.sh and running exactly \`bash autoresearch.sh\`; the harness
itself is arbitrary code. --allow-exec (data/mixed) authorizes any bash/eval.
Neither is a sandbox. Mode is never inferred from files.
Clear retires the mission but never deletes its append-only session history.
Resume starts a new bounded pass and preserves evidence and past verdicts.`;
