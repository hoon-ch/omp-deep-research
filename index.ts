import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { budgetReason, ENTRY_TYPE, executionEvent, intakeEvent, lifecycleEvent, makeEvent, modeEvent, prepareOperation, researchEntries, resetEvent, restore, spendReason, startEvent, summary } from "./src/engine.ts";
import { HELP, parseCommand, specConfig } from "./src/command.ts";
import { blockedReason, childBlockedReason, executionGuidance, INTAKE_POLICY, intakeBlockedReason, isAcquisition, SYSTEM_POLICY, taskItemCount } from "./src/policy.ts";
import { buildReceipt } from "./src/receipts.ts";
import { exportReport } from "./src/report.ts";
import { runTable } from "./src/runs.ts";
import { toolSchema } from "./src/schema.ts";
import { parseSpec } from "./src/spec.ts";
import { object, ResearchError } from "./src/validation.ts";
import type { HostAPI, HostContext, HostUsage, ToolResult } from "./src/host.ts";
import type { LedgerEvent, Mission, MissionSettings, ResearchState, SessionEntry } from "./src/types.ts";

const modelId = (ctx: HostContext) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown-host-model";
const isMain = (ctx: HostContext) => ctx.agent.kind === "main";
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);
const STATUS_KEY = "omp-deep-research";

type Loaded = { state: ResearchState; error?: undefined } | { state?: undefined; error: string };

/**
 * OMP 18.6.1 runs subagents in-process and re-binds this factory per child session, so module state is shared between
 * the main session's instance and its children's. The main instance publishes its mission here (keyed by agent id);
 * a child spawned while that mission is active is bound to it, governed by it, and reports usage for the main instance
 * to persist. Children first seen with no active mission are not governed.
 */
interface LiveMission { mission: Mission; pendingTokens: number; pendingCost: number }
const live = new Map<string, LiveMission>();
const childBinding = new Map<string, { root: string; missionId: string }>();
function usageOf(usage: HostUsage | undefined): { tokens: number; cost: number } {
  const tokens = typeof usage?.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0 ? Math.round(usage.totalTokens) : 0;
  const cost = typeof usage?.cost?.total === "number" && Number.isFinite(usage.cost.total) && usage.cost.total > 0 ? usage.cost.total : 0;
  return { tokens, cost };
}
/** The child's binding, created on first sight by walking parentId to a published main session with an active mission. */
function bindChild(ctx: HostContext): { entry: LiveMission; missionId: string } | undefined {
  let binding = childBinding.get(ctx.agent.id);
  if (!binding) {
    const parent = ctx.agent.parentId;
    const root = parent === undefined ? undefined : live.has(parent) ? parent : childBinding.get(parent)?.root;
    const entry = root === undefined ? undefined : live.get(root);
    if (!root || !entry || entry.mission.phase !== "active") return undefined;
    binding = { root, missionId: entry.mission.id };
    childBinding.set(ctx.agent.id, binding);
  }
  const entry = live.get(binding.root);
  return entry && { entry, missionId: binding.missionId };
}

/** OMP loads this default factory; all mission state comes from the active branch. */
export default function deepResearch(pi: HostAPI): void {
  pi.setLabel("OMP Deep Research");
  // Replay is cached per active branch tip: the same last research event id implies the same research history.
  let cache: { key: string; loaded: Loaded } | undefined;
  function load(ctx: HostContext): Loaded {
    const entries = researchEntries(ctx.sessionManager.getBranch());
    const last: SessionEntry | undefined = entries.at(-1);
    const eventId = last && typeof last.data === "object" && last.data && "id" in last.data ? String(last.data.id) : "";
    const key = `${entries.length}:${last?.id ?? ""}:${eventId}`;
    if (cache?.key !== key) {
      let loaded: Loaded;
      try { loaded = { state: restore(entries) }; } catch (e) { loaded = { error: messageOf(e) }; }
      cache = { key, loaded };
    }
    if (isMain(ctx)) {
      const m = cache.loaded.state?.mission; const entry = live.get(ctx.agent.id);
      if (!m) live.delete(ctx.agent.id);
      else if (entry) entry.mission = m;
      else live.set(ctx.agent.id, { mission: m, pendingTokens: 0, pendingCost: 0 });
    }
    return cache.loaded;
  }
  /** Persists subagent usage reported since the last main-session hook. */
  function flushChildUsage(ctx: HostContext) {
    const entry = live.get(ctx.agent.id); const m = load(ctx).state?.mission;
    if (!entry || !m || (!entry.pendingTokens && !entry.pendingCost)) return;
    persist(makeEvent(m.id, "usage_recorded", { source: "children", tokens: entry.pendingTokens, cost: entry.pendingCost }));
    entry.pendingTokens = 0; entry.pendingCost = 0;
  }
  /** Strict read for operations that must not proceed on an unreadable ledger. */
  function state(ctx: HostContext): ResearchState {
    const l = load(ctx);
    if (l.error !== undefined) throw new ResearchError(`Research ledger unreadable: ${l.error}. Run /deep-research reset-ledger to retire it (history is kept).`);
    return l.state;
  }
  const persist = (event: LedgerEvent) => pi.appendEntry(ENTRY_TYPE, event);
  /** UI when available; print/json modes have no UI, so command output goes to stderr instead of vanishing. */
  function output(ctx: HostContext, message: string, kind: "info" | "warning" | "error" = "info") {
    if (ctx.hasUI) ctx.ui.notify(message, kind);
    else process.stderr.write(`${kind === "info" ? "" : `[deep-research ${kind}] `}${message}\n`);
  }
  function refresh(ctx: HostContext) {
    if (!isMain(ctx) || !ctx.hasUI) return;
    const l = load(ctx);
    if (l.error !== undefined) {
      ctx.ui.setStatus(STATUS_KEY, "Research ledger unreadable · /deep-research reset-ledger"); ctx.ui.setWidget(STATUS_KEY, undefined); return;
    }
    const s = l.state; const m = s.mission;
    const usage = m && m.pass.tokens > 0
      ? ` · ${m.pass.tokens}${m.maxTokens ? `/${m.maxTokens}` : ""} tok (scouts ${m.pass.childTokens})${m.maxCost ? ` · $${m.pass.cost.toFixed(2)}/$${m.maxCost}` : ""}` : "";
    ctx.ui.setStatus(STATUS_KEY, s.intake ? "Research intake · clarify goal, constraints, deliverables, mode"
      : m ? `Research ${m.phase} · ${m.mode} · ${m.evidence.length} evidence · ${m.runs.length} runs · ${m.pass.toolCalls.length}/${m.maxToolCalls} tools · ${m.pass.children}/${m.maxChildren} scouts · ${m.pass.continuations}/${m.maxContinuations} nudges${usage}` : undefined);
    const showRuns = m && m.mode !== "web" && (m.phase === "active" || m.phase === "paused") && m.runs.length > 0;
    ctx.ui.setWidget(STATUS_KEY, showRuns ? runTable(m, 8) : undefined, { placement: "aboveEditor" });
  }
  const pause = (ctx: HostContext, reason: string) => {
    const l = load(ctx);
    if (l.state?.mission?.phase === "active") { persist(lifecycleEvent(l.state, "pause", undefined, reason)); refresh(ctx); }
  };
  const activeMission = (ctx: HostContext) => { const m = load(ctx).state?.mission; return m?.phase === "active" ? m : undefined; };
  for (const name of ["session_start", "session_switch", "session_branch", "session_tree", "session_compact"] as const) pi.on(name, (_event, ctx) => refresh(ctx));

  pi.on("before_agent_start", (event, ctx) => {
    if (!isMain(ctx)) return;
    const s = load(ctx).state;
    // External evidence is never interpolated into the system prompt.
    if (s?.intake) return { systemPrompt: [...event.systemPrompt, INTAKE_POLICY] };
    if (s?.mission?.phase === "active") return { systemPrompt: [...event.systemPrompt, SYSTEM_POLICY] };
  });
  pi.on("session.compacting", (_event, ctx) => {
    if (!isMain(ctx)) return;
    const s = load(ctx).state;
    if (!s?.intake && s?.mission?.phase !== "active") return;
    return { context: ["OMP Deep Research state (intake or mission) is stored in custom session entries. Call deep_research(op='read') after compaction; do not reconstruct evidence from memory."] };
  });

  pi.on("tool_call", (event, ctx) => {
    if (!isMain(ctx)) {
      const bound = bindChild(ctx);
      if (!bound) return;
      const m = bound.entry.mission;
      if (m.id !== bound.missionId) return { block: true, reason: "The Deep Research mission that spawned you has ended; stop and return what you have." };
      const reason = childBlockedReason(m, event.toolName, event.input)
        ?? spendReason(m, Date.now(), bound.entry.pendingTokens, bound.entry.pendingCost);
      return reason ? { block: true, reason } : undefined;
    }
    flushChildUsage(ctx);
    const l = load(ctx);
    // Fail closed: if the ledger cannot be read, the research policy state is unknown.
    if (l.error !== undefined) return event.toolName === "deep_research" ? undefined
      : { block: true, reason: `Deep Research ledger unreadable (${l.error}). Ask the user to run /deep-research reset-ledger.` };
    const s = l.state; const m = s.mission;
    if (s.intake) {
      const reason = intakeBlockedReason(event.toolName);
      return reason ? { block: true, reason } : undefined;
    }
    if (!m || m.phase !== "active") return;
    const blocked = blockedReason(m, event.toolName, event.input, ctx.cwd);
    if (blocked) return { block: true, reason: blocked };
    if (!isAcquisition(event.toolName)) return;
    if (m.pass.toolCalls.includes(event.toolCallId)) return;
    const exhausted = budgetReason(m);
    if (exhausted) return { block: true, reason: `${exhausted}. Use the recorded evidence to save an honest verdict; do not start new acquisition.` };
    const children = event.toolName === "task" ? taskItemCount(event.input) : 0;
    if (children && m.pass.children + children > m.maxChildren)
      return { block: true, reason: `Subagent budget: ${m.maxChildren - m.pass.children} of ${m.maxChildren} left this pass, ${children} requested. Spawn fewer scouts or explore yourself.` };
    persist(makeEvent(m.id, "tool_counted", { toolCallId: event.toolCallId, ...(children ? { children } : {}) }));
    refresh(ctx);
  });
  pi.on("tool_result", (event: ToolResult, ctx) => {
    if (!isMain(ctx) || !isAcquisition(event.toolName)) return;
    flushChildUsage(ctx);
    const m = activeMission(ctx);
    if (!m || !m.pass.toolCalls.includes(event.toolCallId) || m.receipts.some(r => r.id === event.toolCallId)) return;
    persist(makeEvent(m.id, "receipt_recorded", { receipt: buildReceipt(event, spec => ctx.models.resolve(spec), ctx.cwd) }));
    refresh(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const { tokens, cost } = usageOf(event.message.usage);
    if (!tokens && !cost) return;
    if (!isMain(ctx)) {
      // Child usage is handed to the main instance; only it can append to the mission's session.
      const bound = bindChild(ctx);
      if (bound && bound.entry.mission.id === bound.missionId) { bound.entry.pendingTokens += tokens; bound.entry.pendingCost += cost; }
      return;
    }
    flushChildUsage(ctx);
    const m = activeMission(ctx);
    if (m) { persist(makeEvent(m.id, "usage_recorded", { source: "assistant", tokens, cost })); refresh(ctx); }
  });

  pi.on("agent_end", (event, ctx) => {
    if (!isMain(ctx) || event.willContinue) return;
    const last = [...event.messages].reverse().find(m => m.role === "assistant");
    if (last?.stopReason === "aborted" || last?.stopReason === "error") pause(ctx, `Agent stopped with ${last.stopReason}; explicit resume is required.`);
  });
  pi.on("session_stop", (event, ctx) => {
    if (!isMain(ctx)) return;
    flushChildUsage(ctx);
    const m = activeMission(ctx);
    if (!m) return;
    if (event.signal.aborted || ["aborted", "error"].includes(event.last_assistant_message?.stopReason ?? "")) {
      pause(ctx, "Interrupted or failed; automatic continuation is disabled until explicit resume."); return;
    }
    if (ctx.hasPendingMessages()) return; // Never jump ahead of a queued user message.
    const exhausted = budgetReason(m);
    if (exhausted || m.pass.continuations >= m.maxContinuations) {
      pause(ctx, exhausted ?? "Continuation budget exhausted before a verdict was saved.");
      output(ctx, "Research paused at its budget. Evidence is saved; use /deep-research resume or export.", "warning"); return;
    }
    const stopId = `${event.session_id}:${m.pass.id}:${event.turn_id}`;
    if (m.pass.stopIds.includes(stopId)) return;
    persist(makeEvent(m.id, "continuation_requested", { stopId }));
    refresh(ctx);
    const last = m.pass.continuations + 1 >= m.maxContinuations;
    return { continue: true, additionalContext: last
      ? "Final Deep Research continuation for this pass: read the durable mission and save a best-effort verdict NOW. Use inconclusive with caveats when evidence is insufficient. Do not launch new searches or experiments."
      : "Deep Research has no verdict for this active pass. Read the mission with deep_research, investigate the highest-value evidence gap within the remaining budget, then persist a structured verdict. Never fabricate sources or continue after cancellation." };
  });

  pi.registerTool({
    name: "deep_research", label: "Deep Research", loadMode: "essential", approval: "write",
    description: "Operate the user's Deep Research intake or mission: start a mission after a /deep-research intake clarified objective/mode/constraints/deliverables; read summary/full/receipts/runs, the critic brief or the iterate (next-experiment) brief; record source-linked evidence, harness segments, observed metric runs, flags, notes, critic receipts and conclusive/inconclusive verdicts; explicitly export local reports. Only the user /deep-research command opens an intake or starts/pauses/resumes/clears missions, and budgets/execution consent are never tool-controlled. No network or code execution occurs inside this tool.",
    parameters: toolSchema(pi.zod),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      try {
        if (signal?.aborted) throw new ResearchError("Cancelled before research operation; no change was saved");
        if (!isMain(ctx)) throw new ResearchError("Only the main session owns research state; return your findings to the parent instead");
        const s = state(ctx);
        const raw = object(input);
        const prepared = prepareOperation(s, raw, toolCallId, modelId(ctx), ctx.cwd);
        // Persist before returning success. If persistence throws, the caller sees an error.
        if (prepared.event) persist(prepared.event);
        // A mission started mid-turn has not seen the mission system policy yet; return it with the start result.
        const result = raw.op === "export" ? exportReport(s, ctx.cwd)
          : raw.op === "start" && prepared.event ? { ...object(prepared.result), next: ["Mission started. Continue in this turn: research it now within its budgets and finish with a verdict.", executionGuidance(state(ctx).mission!)].filter(Boolean).join(" "), policy: SYSTEM_POLICY } : prepared.result;
        refresh(ctx);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: { result } };
      } catch (error) {
        return { content: [{ type: "text", text: messageOf(error) }], details: { error: messageOf(error) }, isError: true };
      }
    },
  });
  /** Resolves the operator's critic selector to the host's canonical `provider/id`; never substitutes. */
  function resolveCritic(ctx: HostContext, settings: MissionSettings) {
    if (!settings.criticModel) return;
    const model = ctx.models.resolve(settings.criticModel);
    if (!model) throw new ResearchError(`Configured critic is unavailable: ${settings.criticModel}. No model substitution was made.`);
    settings.criticModel = `${model.provider}/${model.id}`;
    if (settings.criticModel === modelId(ctx)) throw new ResearchError("Select a critic model distinct from the main research model");
  }
  pi.registerCommand("deep-research", {
    description: "Evidence-driven web/data/mixed research; intake, spec, harness, status, runs, mode, allow, deny, pause, resume, cancel, clear, export",
    async handler(args, ctx) {
      try {
        if (!isMain(ctx)) throw new ResearchError("Start research in the main OMP session");
        const command = parseCommand(args, modelId(ctx));
        if (command.op === "help") { output(ctx, HELP); return; }
        if (command.op === "reset-ledger") {
          const l = load(ctx);
          if (l.state?.intake || (l.state?.mission && ["active", "paused"].includes(l.state.mission.phase)))
            throw new ResearchError("The ledger is readable and has open work; use cancel or clear instead of reset-ledger");
          persist(resetEvent(l.error ?? "Operator reset")); refresh(ctx); output(ctx, "Research ledger reset. Earlier events stay in the session history but are no longer replayed."); return;
        }
        if (command.op === "status") { output(ctx, JSON.stringify(summary(state(ctx)), null, 2)); return; }
        if (command.op === "runs") {
          const m = state(ctx).mission;
          if (!m) throw new ResearchError("No mission");
          output(ctx, runTable(m, 40).join("\n")); return;
        }
        if (command.op === "export") { output(ctx, JSON.stringify(exportReport(state(ctx), ctx.cwd), null, 2)); return; }
        if (command.op === "mode") {
          persist(modeEvent(state(ctx), command.mode)); refresh(ctx);
          output(ctx, `Mission mode set to ${command.mode}. Existing evidence is kept; new evidence and tools follow the new mode.`); return;
        }
        if (command.op === "allow" || command.op === "deny") {
          const permission = command.op === "allow" ? command.permission : "deny";
          persist(executionEvent(state(ctx), permission)); refresh(ctx);
          output(ctx, permission === "deny"
            ? "Execution permission revoked. Future active-research harness writes and bash/eval calls are blocked; already-running commands are not stopped."
            : permission === "harness"
              ? "Harness permission enabled; unrestricted exec revoked. Only writing ./autoresearch.sh and running `bash autoresearch.sh` are allowed. The harness is arbitrary code, not an OS sandbox."
              : "Exec permission enabled: bash/eval can modify your machine. This is not an OS sandbox.", permission === "deny" ? "info" : "warning");
          output(ctx, "Existing evidence, phase and budgets are kept. If paused, use /deep-research resume to continue."); return;
        }
        if (["pause", "cancel", "clear"].includes(command.op)) {
          const before = state(ctx);
          const busy = before.intake !== undefined || before.mission?.phase === "active";
          persist(lifecycleEvent(before, command.op as "pause" | "cancel" | "clear"));
          if (busy) ctx.abort();
          refresh(ctx); output(ctx, `Research ${command.op} saved. Session ledger retained.`); return;
        }
        const runsTurn = command.op === "start" || command.op === "spec" || command.op === "intake" || command.op === "resume";
        // OMP 18.6.1 print mode queues a command's follow-up turn but exits without running it (and never flushes the session).
        if (runsTurn && (ctx.mode === "print" || ctx.mode === "json"))
          throw new ResearchError("omp -p cannot run a mission started by a command; use interactive omp or `omp --mode rpc --no-ui` (send the command as a prompt and wait for session_settled)");
        if (command.op === "intake" && !ctx.hasUI) throw new ResearchError("An intake needs an interactive UI to ask clarifying questions; headless runs must use --mode or --spec");
        await ctx.waitForIdle();
        if (command.op === "start" || command.op === "intake" || command.op === "spec") {
          const settings = command.op === "start" ? command.config : command.settings;
          resolveCritic(ctx, settings);
          if (command.op === "spec") {
            const path = resolvePath(ctx.cwd, command.path);
            let text: string;
            try { text = readFileSync(path, "utf8"); } catch (e) { throw new ResearchError(`Cannot read spec ${command.path}: ${messageOf(e)}`); }
            const config = specConfig(parseSpec(text, command.path), command.settings, { path, sha256: createHash("sha256").update(text).digest("hex") }, command.mode);
            persist(startEvent(state(ctx), config));
          } else persist(command.op === "start" ? startEvent(state(ctx), command.config) : intakeEvent(state(ctx), command.draft, command.settings));
          if (settings.allowExec) output(ctx, "Execution enabled by --allow-exec: bash/eval can modify your machine. This is not an OS sandbox.", "warning");
          else if (settings.allowHarness) output(ctx, "Harness enabled by --harness: the agent may write and run ./autoresearch.sh, which is arbitrary code. This is not an OS sandbox.", "warning");
        } else if (command.op === "resume") persist(lifecycleEvent(state(ctx), "resume"));
        refresh(ctx);
        const mission = state(ctx).mission;
        const guidance = command.op !== "intake" && mission ? executionGuidance(mission) : undefined;
        if (guidance) output(ctx, "Execution is disabled. If experiments are needed, use /deep-research allow harness (narrower) or allow exec (arbitrary bash/eval).");
        // Queued behind the command; interactive and RPC hosts run it once the command returns.
        await pi.sendUserMessage(command.op === "intake"
          ? `A Deep Research intake is open. Draft objective from the user: ${JSON.stringify(command.draft || "(none)")}. Before any research tool runs, clarify the goal, constraints, deliverables and the mission mode (web, data or mixed) with the user using ask. Then call deep_research(op='start') with the clarified mission and, once it succeeds, carry out the research immediately in the same turn.`
          : "Run the active OMP Deep Research mission. First call deep_research(op='read') for its explicit objective, mode, constraints and remaining budgets. Split it into sub-questions; if two or more are independent, fan them out to cheap scouts via deep_research(op='read',view='explore') and one task call before searching yourself. Inspect actual sources, record evidence receipts, and finish with an honest structured verdict. " +
            "Never modify product code or OMP's existing goal. Respect interruption. A conclusive or inconclusive verdict ends this pass. " + (guidance ?? ""), { attribution: "agent" });
      } catch (error) {
        output(ctx, messageOf(error), "error");
      }
    },
  });
}
