/** Shared critic plumbing for the benchmark: the brief, the assignment a critic receives, token proxy, and host-path recording. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CRITIC_AGENT } from "../../src/briefs.ts";
import { ENTRY_TYPE, makeEvent, prepareOperation, restore } from "../../src/engine.ts";
import { buildReceipt } from "../../src/receipts.ts";
import type { ModelIdentity } from "../../src/host.ts";
import type { LedgerEvent, SessionEntry } from "../../src/types.ts";
import { isRecord } from "../../src/validation.ts";
import { CWD } from "./fixtures.ts";

export const CRITIC_MODEL = "openai-codex/gpt-6.1-sol";
/** The critic agent definition's body: the system prompt the plugin ships for `deep-research-critic`. */
export const AGENT_BODY = readFileSync(new URL("../../agents/deep-research-critic.md", import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "").trim();
export function resolver(roleModel = CRITIC_MODEL) {
  return (spec: string): ModelIdentity | undefined => {
    const target = spec === "@review_worker" ? roleModel : spec;
    const [provider, ...id] = target.split("/");
    return provider && id.length ? { provider, id: id.join("/") } : undefined;
  };
}

export interface Brief { instructions: string; snapshot: Record<string, unknown>; raw: Record<string, unknown> }
export function brief(entries: SessionEntry[]): Brief {
  const raw = prepareOperation(restore(entries), { op: "read", view: "critic" }, "brief", "bench/main", CWD).result;
  if (!isRecord(raw) || typeof raw.instructions !== "string" || !isRecord(raw.snapshot)) throw new Error("critic brief without instructions/snapshot");
  return { instructions: raw.instructions, snapshot: raw.snapshot, raw };
}
/**
 * The critic's user message as a live OMP 18.11 run delivered it: the host's task prefix, then the brief instructions and
 * the snapshot JSON, which the main model passed compactly (observed in the recorded live run). The compact form is the
 * conservative baseline: a model copying the pretty-printed tool result would send more.
 */
export function assignment(instructions: string, snapshot: unknown): string {
  return `Complete assignment thoroughly:\n\n# Instructions\n${instructions}\n\n# Snapshot JSON\n${JSON.stringify(snapshot)}`;
}
/** What the main agent's context carries per review: the view:"critic" tool result (as index.ts renders it) and its task call. */
export function researchTexts(b: Brief, text: string): string[] {
  return [JSON.stringify(b.raw, null, 2), JSON.stringify({ context: "Read-only critic review for an OMP Deep Research mission.", tasks: [{ agent: CRITIC_AGENT, name: "Critic", task: text }] })];
}

const PYTHON = process.env.CRITIC_BENCH_PYTHON ?? "/tmp/critic-bench-venv/bin/python";
export function countTokens(texts: string[]): number[] {
  const out = spawnSync(PYTHON, [new URL("./tokens.py", import.meta.url).pathname], { input: JSON.stringify(texts), maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(`tokens.py failed (set CRITIC_BENCH_PYTHON to a Python with tiktoken): ${out.stderr}`);
  return JSON.parse(out.stdout.toString()) as number[];
}

let serial = 0;
export function appendEvent(entries: SessionEntry[], event: LedgerEvent | undefined): void {
  if (event) entries.push({ type: "custom", customType: ENTRY_TYPE, data: event });
}
export interface Spawn { task: string; roleModel?: string; fallback?: boolean; resolvedModel?: string }
export type Recorded = { ok: true } | { ok: false; error: string };
/** Records a critic the way a live mission does: a task receipt for the spawn, a read of `agent://<id>`, then op:"critic". */
export function recordCritic(entries: SessionEntry[], spawn: Spawn, answer: string, evaluator = CRITIC_MODEL): Recorded {
  const id = `Critic${++serial}`; const missionId = restore(entries).mission!.id;
  const row = { index: 0, id, modelRole: "review_worker", ...(spawn.resolvedModel ? { resolvedModel: spawn.resolvedModel, resolvedModelIsFallback: !!spawn.fallback } : {}) };
  const task = buildReceipt({ toolName: "task", toolCallId: `task-${id}`, isError: false, content: [{ type: "text", text: `Spawned agent \`${id}\`` }],
    input: { context: "Read-only critic review for an OMP Deep Research mission.", tasks: [{ agent: CRITIC_AGENT, name: id, task: spawn.task }] },
    details: { progress: [row] } }, resolver(spawn.roleModel), CWD);
  appendEvent(entries, makeEvent(missionId, "receipt_recorded", { receipt: task }));
  const read = buildReceipt({ toolName: "read", toolCallId: `read-${id}`, isError: false, input: { path: `agent://${id}` },
    content: [{ type: "text", text: answer }], details: { resolvedPath: `/tmp/${id}.md`, displayContent: { text: answer, startLine: 1 } } }, resolver(spawn.roleModel), CWD);
  appendEvent(entries, makeEvent(missionId, "receipt_recorded", { receipt: read }));
  try {
    appendEvent(entries, prepareOperation(restore(entries), { op: "critic", critic: { evaluator, receiptId: read.id, spawnReceiptId: task.id } }, `critic-${id}`, "anthropic/claude-opus-5-5", CWD).event);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
