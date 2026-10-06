/**
 * Deliberately small structural contract for the public OMP API.
 * Reviewed against OMP types.ts blob 3dec4e6ac286199555e202829e20a6f54ac97f90.
 * No imports from private OMP internals and no runtime dependency on its npm package.
 * Contract tests are not a substitute for a real installed-host integration run.
 */
import type { SessionEntry } from "./types.ts";
export interface ModelIdentity { provider: string; id: string; }
export interface HostMessage { role?: string; stopReason?: string; content?: unknown; }
export interface HostContext {
  cwd: string;
  hasUI: boolean;
  model?: ModelIdentity;
  agent: { kind: "main" | "sub"; id: string; parentId?: string };
  sessionManager: { getBranch(): SessionEntry[]; getSessionId(): string };
  ui: { notify(message: string, kind: "info" | "warning" | "error"): void; setStatus(key: string, value: string | undefined): void };
  models: { resolve(spec: string): ModelIdentity | undefined };
  hasPendingMessages(): boolean;
  abort(): void;
}
export interface CommandContext extends HostContext { waitForIdle(): Promise<void>; }
export interface ToolCall { toolName: string; toolCallId: string; input: Record<string, unknown>; }
export interface ToolResult extends ToolCall { content: Array<{ type: string; text?: string }>; isError: boolean; }
export interface StopEvent { turn_id: number; session_id: string; signal: AbortSignal; last_assistant_message?: HostMessage; }
export interface Events {
  session_start: unknown; session_switch: unknown; session_branch: unknown; session_tree: unknown; session_compact: unknown;
  before_agent_start: { prompt: string; systemPrompt: string[] };
  "session.compacting": unknown;
  tool_call: ToolCall; tool_result: ToolResult; session_stop: StopEvent;
  agent_end: { messages: HostMessage[]; willContinue?: boolean };
}
export interface Schema { optional(): Schema; }
export interface SchemaBuilder {
  object(shape: Record<string, Schema>): Schema;
  string(): Schema; number(): Schema; boolean(): Schema;
  enum(values: readonly string[]): Schema; array(schema: Schema): Schema;
}
export interface ToolDefinition {
  name: string; label: string; description: string; parameters: Schema;
  approval: "write"; loadMode: "essential";
  execute(callId: string, input: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: HostContext): Promise<{
    content: Array<{ type: "text"; text: string }>; details?: unknown; isError?: boolean;
  }>;
}
export interface HostAPI {
  zod: SchemaBuilder;
  setLabel(label: string): void;
  on<K extends keyof Events>(event: K, handler: (event: Events[K], ctx: HostContext) => unknown | Promise<unknown>): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, command: { description: string; handler(args: string, ctx: CommandContext): Promise<void> }): void;
  appendEntry(type: string, data: unknown): void;
  sendUserMessage(content: string, options?: { attribution?: "agent" | "user" }): void | Promise<void>;
}
