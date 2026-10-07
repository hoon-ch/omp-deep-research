export type Mode = "web" | "data" | "mixed";
export type Disposition = "conclusive" | "inconclusive";
export type Phase = "active" | "paused" | "completed" | "cancelled";
export type Confidence = "low" | "medium" | "high";
export type RunOutcome = "baseline" | "keep" | "discard" | "crash" | "checks_failed";

export type Direction = "lower" | "higher";
export type AsiValue = string | number | boolean;
export interface MetricContract {
  name: string;
  direction: Direction;
}
/** Operator-chosen settings; they exist before an intake clarifies objective and mode. */
export interface MissionSettings {
  constraints: string[];
  deliverables: string[];
  maxContinuations: number;
  maxToolCalls: number;
  /** Per-pass cap on spawned subagents (each `task` item counts once). */
  maxChildren: number;
  maxMinutes: number;
  /** Optional per-pass caps on model usage (tokens, provider-reported USD), main session plus its subagents. */
  maxTokens?: number;
  maxCost?: number;
  allowExec: boolean;
  allowHarness: boolean;
  metric?: MetricContract;
  criticModel?: string;
  primaryModel?: string;
}
export interface SpecSource {
  path: string;
  sha256: string;
}
export interface MissionConfig extends MissionSettings {
  objective: string;
  mode: Mode;
  spec?: SpecSource;
}
export interface Intake {
  id: string;
  startedAt: string;
  draft: string;
  settings: MissionSettings;
}
export interface Pass {
  id: string;
  startedAt: string;
  deadlineAt: string;
  continuations: number;
  toolCalls: string[];
  stopIds: string[];
  /** Subagents spawned in this pass. */
  children: number;
  /** Usage in this pass: main-session assistant messages plus subagent messages (children* is the subagent share). */
  tokens: number;
  cost: number;
  childTokens: number;
  childCost: number;
}
export interface Receipt {
  id: string;
  tool: string;
  at: string;
  inputHash: string;
  outputHash: string;
  preview: string;
  isError: boolean;
  metrics: Record<string, number>;
  metricError?: string;
  asi: Record<string, AsiValue>;
  /** `read` only: what the call actually opened — the requested path/URL and the host-reported URL and final URL after redirects. */
  opened?: string[];
  /** URLs that merely appear in the output (page links, scout suggestions): leads, never proof of reading them. */
  links: string[];
  /** Local files whose content the result returned (a read file, or files with returned grep/ast_grep matches), with the lines shown. */
  files?: ReceiptFile[];
  /** `glob`/`find`: local paths the result listed. Existence only, never content. */
  listed?: string[];
  /** `task` only: one record per spawned agent, so a model is tied to the agent that ran it. */
  agents?: TaskAgent[];
  /** Structured critic response found in this result (e.g. a `read` of the critic's `agent://<id>`). */
  review?: CriticReview;
}
export interface ReceiptFile {
  /** Absolute path. */
  path: string;
  /** Merged 1-based line spans whose text the result showed; absent when the host did not report them. */
  lines?: [number, number][];
  /** The result showed the whole file. */
  complete?: true;
}
export interface TaskAgent {
  id: string;
  /** Host-resolved `provider/id` of the task item's single-model pin. */
  requestedModel?: string;
  /** Host-reported `provider/id` the agent ran (blocking results). */
  resolvedModel?: string;
  /** The host reported a fallback model: nothing proves which requested model ran. */
  fallback?: true;
  /** Hashes (`snapshotHash`) of the critic snapshots its own assignment carried. */
  briefs?: string[];
  /** Its assignment carried the complete `view:"critic"` instructions verbatim (whitespace-insensitive). */
  instructed?: true;
  /** Structured critic response of a blocking result. */
  review?: CriticReview;
}
/** The critic's own structured answer, including the digest of the snapshot it reviewed. */
export interface CriticReview {
  assessment: "pass" | "revise";
  summary: string;
  concerns: string[];
  evidenceIds: string[];
  evidenceDigest: string;
}
export interface EvidenceInput {
  source: "web" | "file" | "listing" | "experiment";
  title: string;
  claim: string;
  summary: string;
  locator: string;
  receiptId: string;
  stance: "supports" | "contradicts" | "context";
}
export interface Evidence extends EvidenceInput {
  id: string;
  at: string;
  fingerprint: string;
}
export interface RunInput {
  label: string;
  hypothesis: string;
  receiptId: string;
  primaryMetric?: string;
  direction?: Direction;
  checksPassed?: boolean;
  notes?: string;
}
export interface Run {
  id: string;
  at: string;
  segment: number;
  label: string;
  hypothesis: string;
  receiptId: string;
  primaryMetric: string;
  direction: Direction;
  metrics: Record<string, number>;
  asi: Record<string, AsiValue>;
  outcome: RunOutcome;
  checksPassed?: boolean;
  notes?: string;
  flagReason?: string;
}
export interface Segment {
  index: number;
  at: string;
  reason: string;
  metric?: MetricContract;
}
export interface CriticInput {
  evaluator: string;
  /** Receipt holding the critic's structured response. */
  receiptId: string;
  /** `task` receipt that spawned the critic with a pinned model. */
  spawnReceiptId: string;
}
/** Assessment, concerns, evidence IDs and digest come from the critic's response, never from the recording model. */
export interface Critic extends CriticInput, CriticReview {
  id: string;
  at: string;
  /** Spawned agent whose response this is. */
  agentId: string;
}
export interface Finding {
  claim: string;
  evidenceIds: string[];
}
export interface VerdictInput {
  disposition: Disposition;
  confidence: Confidence;
  summary: string;
  findings: Finding[];
  caveats: string[];
}
export interface Verdict extends VerdictInput {
  id: string;
  at: string;
  evaluator: string;
  evidenceDigest: string;
  criticId?: string;
}
export interface Mission extends MissionConfig {
  id: string;
  createdAt: string;
  phase: Phase;
  pass: Pass;
  pauseReason?: string;
  receipts: Receipt[];
  evidence: Evidence[];
  runs: Run[];
  segments: Segment[];
  critics: Critic[];
  verdicts: Verdict[];
  notes: string;
}
export type EventType =
  | "ledger_reset"
  | "intake_started" | "intake_cancelled"
  | "mission_created" | "mode_set" | "execution_set" | "pass_resumed" | "pass_paused" | "mission_cancelled" | "mission_cleared"
  | "tool_counted" | "children_released" | "receipt_recorded" | "continuation_requested"
  | "evidence_added" | "segment_started" | "run_logged" | "run_flagged" | "notes_updated"
  | "usage_recorded" | "critic_recorded" | "verdict_issued";
export interface LedgerEvent {
  schemaVersion: 1;
  id: string;
  missionId: string;
  at: string;
  type: EventType;
  data: unknown;
  requestId?: string;
  requestHash?: string;
}
export interface ResearchState { mission?: Mission; intake?: Intake; events: LedgerEvent[]; }
export interface SessionEntry { id?: string; type: string; customType?: string; data?: unknown; }
export interface MissionInput {
  objective: string;
  mode: Mode;
  constraints: string[];
  deliverables: string[];
  metric?: MetricContract;
}
export interface ToolInput {
  op: "read" | "start" | "evidence" | "segment" | "run" | "flag_run" | "notes" | "critic" | "verdict" | "export";
  view?: "summary" | "full" | "receipts" | "runs" | "explore" | "critic" | "iterate";
  mission?: MissionInput;
  limit?: number;
  offset?: number;
  requestId?: string;
  evidence?: EvidenceInput;
  segment?: { reason: string; metric?: MetricContract };
  run?: RunInput;
  runId?: string;
  reason?: string;
  notes?: string;
  critic?: CriticInput;
  verdict?: VerdictInput;
}
