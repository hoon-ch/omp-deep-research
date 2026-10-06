import { createHash } from "node:crypto";
import { budgetReason, ENTRY_TYPE, lifecycleEvent, makeEvent, prepareOperation, restore, startEvent, summary } from "./src/engine.ts";
import { HELP, parseCommand } from "./src/command.ts";
import { blockedReason, isAcquisition, SYSTEM_POLICY } from "./src/policy.ts";
import { exportReport } from "./src/report.ts";
import { toolSchema } from "./src/schema.ts";
import { hash, object, parseMetrics, ResearchError } from "./src/validation.ts";
import type { HostAPI, HostContext, ToolResult } from "./src/host.ts";
import type { LedgerEvent, Receipt } from "./src/types.ts";

const modelId = (ctx: HostContext) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown-host-model";
const isMain = (ctx: HostContext) => ctx.agent.kind === "main";
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);

/** OMP loads this default factory; all mission state comes from the active branch. */
export default function deepResearch(pi: HostAPI): void {
  pi.setLabel("OMP Deep Research");
  const state = (ctx: HostContext) => restore(ctx.sessionManager.getBranch());
  const persist = (event: LedgerEvent) => pi.appendEntry(ENTRY_TYPE, event);
  function notify(ctx: HostContext, message: string, kind: "info" | "warning" | "error" = "info") {
    if (ctx.hasUI) ctx.ui.notify(message, kind);
  }
  function refresh(ctx: HostContext) {
    if (!isMain(ctx) || !ctx.hasUI) return;
    const m = state(ctx).mission;
    ctx.ui.setStatus("omp-deep-research", m ? `Research ${m.phase} · ${m.mode} · ${m.evidence.length} evidence · ${m.pass.toolCalls.length}/${m.maxToolCalls} tools · ${m.pass.continuations}/${m.maxContinuations} nudges` : undefined);
  }
  const pause = (ctx: HostContext, reason: string) => {
    const s = state(ctx);
    if (s.mission?.phase === "active") { persist(lifecycleEvent(s, "pause", undefined, reason)); refresh(ctx); }
  };
  for (const name of ["session_start", "session_switch", "session_branch", "session_tree", "session_compact"] as const) pi.on(name, (_event, ctx) => refresh(ctx));

  pi.on("before_agent_start", (event, ctx) => {
    if (!isMain(ctx) || state(ctx).mission?.phase !== "active") return;
    // External evidence is never interpolated into the system prompt.
    return { systemPrompt: [...event.systemPrompt, SYSTEM_POLICY] };
  });
  pi.on("session.compacting", (_event, ctx) => {
    if (!isMain(ctx) || state(ctx).mission?.phase !== "active") return;
    return { context: ["OMP Deep Research mission state is stored in custom session entries. Call deep_research(op='read') after compaction; do not reconstruct evidence from memory."] };
  });

  pi.on("tool_call", (event, ctx) => {
    if (!isMain(ctx)) return;
    const s = state(ctx); const m = s.mission;
    if (!m || m.phase !== "active") return;
    const blocked = blockedReason(m, event.toolName, event.input);
    if (blocked) return { block: true, reason: blocked };
    if (!isAcquisition(event.toolName)) return;
    if (m.pass.toolCalls.includes(event.toolCallId)) return;
    const exhausted = budgetReason(m);
    if (exhausted) return { block: true, reason: `${exhausted}. Use the recorded evidence to save an honest verdict; do not start new acquisition.` };
    persist(makeEvent(m.id, "tool_counted", { toolCallId: event.toolCallId }));
    refresh(ctx);
  });
  pi.on("tool_result", (event: ToolResult, ctx) => {
    if (!isMain(ctx) || !isAcquisition(event.toolName)) return;
    const s = state(ctx); const m = s.mission;
    if (!m || m.phase !== "active" || !m.pass.toolCalls.includes(event.toolCallId) || m.receipts.some(r => r.id === event.toolCallId)) return;
    const output = event.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
    const parsed = parseMetrics(output);
    const sourceRefs = [...new Set([
      ...(typeof event.input.path === "string" ? [event.input.path] : []),
      ...(output.match(/https?:\/\/[^\s<>"'\]\)]+/g) ?? []),
    ])].slice(0, 40);
    const receipt: Receipt = { id: event.toolCallId, tool: event.toolName, at: new Date().toISOString(), inputHash: hash(event.input),
      outputHash: createHash("sha256").update(output).digest("hex"), preview: output.slice(0, 2400), isError: event.isError,
      metrics: parsed.metrics, ...(parsed.error ? { metricError: parsed.error } : {}), sourceRefs };
    persist(makeEvent(m.id, "receipt_recorded", { receipt }));
  });

  pi.on("agent_end", (event, ctx) => {
    if (!isMain(ctx) || event.willContinue) return;
    const last = [...event.messages].reverse().find(m => m.role === "assistant");
    if (last?.stopReason === "aborted" || last?.stopReason === "error") pause(ctx, `Agent stopped with ${last.stopReason}; explicit resume is required.`);
  });
  pi.on("session_stop", (event, ctx) => {
    if (!isMain(ctx)) return;
    const s = state(ctx); const m = s.mission;
    if (!m || m.phase !== "active") return;
    if (event.signal.aborted || ["aborted", "error"].includes(event.last_assistant_message?.stopReason ?? "")) {
      pause(ctx, "Interrupted or failed; automatic continuation is disabled until explicit resume."); return;
    }
    if (ctx.hasPendingMessages()) return; // Never jump ahead of a queued user message.
    const exhausted = budgetReason(m);
    if (exhausted || m.pass.continuations >= m.maxContinuations) {
      pause(ctx, exhausted ?? "Continuation budget exhausted before a verdict was saved.");
      notify(ctx, "Research paused at its budget. Evidence is saved; use /deep-research resume or export.", "warning"); return;
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
    description: "Manage an already-started research mission: read summary/full/receipts; record source-linked evidence, observed metric runs, flags, notes, critic receipts and conclusive/inconclusive verdicts; explicitly export local reports. Start/pause/resume/clear require the user /deep-research command. No network or code execution occurs inside this tool.",
    parameters: toolSchema(pi.zod),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      try {
        if (signal?.aborted) throw new ResearchError("Cancelled before research operation; no change was saved");
        if (!isMain(ctx)) throw new ResearchError("Only the main session owns research state; return your findings to the parent instead");
        const s = state(ctx);
        const raw = object(input);
        const prepared = prepareOperation(s, raw, toolCallId, modelId(ctx));
        // Persist before returning success. If persistence throws, the caller sees an error.
        if (prepared.event) persist(prepared.event);
        const result = raw.op === "export" ? exportReport(s, ctx.cwd) : prepared.result;
        refresh(ctx);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: { result } };
      } catch (error) {
        return { content: [{ type: "text", text: messageOf(error) }], details: { error: messageOf(error) }, isError: true };
      }
    },
  });
  pi.registerCommand("deep-research", {
    description: "Evidence-driven web/data/mixed research; status, pause, resume, cancel, clear, export",
    async handler(args, ctx) {
      try {
        if (!isMain(ctx)) throw new ResearchError("Start research in the main OMP session");
        const command = parseCommand(args, modelId(ctx));
        if (command.op === "help") { notify(ctx, HELP); return; }
        if (command.op === "status") { notify(ctx, JSON.stringify(summary(state(ctx)), null, 2)); return; }
        if (command.op === "export") { notify(ctx, JSON.stringify(exportReport(state(ctx), ctx.cwd), null, 2)); return; }
        if (["pause", "cancel", "clear"].includes(command.op)) {
          const wasActive = state(ctx).mission?.phase === "active";
          persist(lifecycleEvent(state(ctx), command.op as "pause" | "cancel" | "clear"));
          if (wasActive) ctx.abort();
          refresh(ctx); notify(ctx, `Research ${command.op} saved. Session ledger retained.`); return;
        }
        await ctx.waitForIdle();
        if (command.op === "start") {
          if (command.config.criticModel) {
            const model = ctx.models.resolve(command.config.criticModel);
            if (!model) throw new ResearchError(`Configured critic is unavailable: ${command.config.criticModel}. No model substitution was made.`);
            command.config.criticModel = `${model.provider}/${model.id}`;
            if (command.config.criticModel === modelId(ctx)) throw new ResearchError("Select a critic model distinct from the main research model");
          }
          persist(startEvent(state(ctx), command.config));
          if (command.config.allowExec) notify(ctx, "Execution enabled by --allow-exec: bash/eval can modify your machine. This is not an OS sandbox.", "warning");
        } else if (command.op === "resume") persist(lifecycleEvent(state(ctx), "resume"));
        refresh(ctx);
        await pi.sendUserMessage("Run the active OMP Deep Research mission. First call deep_research(op='read') for its explicit objective, mode, constraints and remaining budgets. Inspect actual sources, record evidence receipts, and finish with an honest structured verdict. " +
          "Never modify product code or OMP's existing goal. Respect interruption. A conclusive or inconclusive verdict ends this pass.", { attribution: "agent" });
      } catch (error) {
        if (!ctx.hasUI) throw error;
        notify(ctx, messageOf(error), "error");
      }
    },
  });
}
