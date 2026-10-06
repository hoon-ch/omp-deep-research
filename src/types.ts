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
  maxMinutes: number;
  /** Optional per-pass caps on main-session model usage (tokens, provider-reported USD), checked at checkpoints. */
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
  /** Main-session assistant usage accumulated from message_end plus task-reported child usage. */
  tokens: number;
  cost: number;
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
  sourceRefs: string[];
  /** For `task` receipts: host-resolved `provider/id` models the call pinned or the host reported as used. */
  models?: string[];
  /** For `task` receipts: agent ids the spawn reported, so a later `read agent://<id>` can be linked back. */
  agentIds?: string[];
}
export interface EvidenceInput {
  source: "web" | "file" | "experiment";
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
  receiptId: string;
  /** `task` receipt that spawned the critic with a pinned model; required when a critic model is configured. */
  spawnReceiptId?: string;
  evidenceIds: string[];
  assessment: "pass" | "revise";
  summary: string;
  concerns: string[];
}
export interface Critic extends CriticInput {
  id: string;
  at: string;
  evidenceDigest: string;
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
  | "mission_created" | "mode_set" | "pass_resumed" | "pass_paused" | "mission_cancelled" | "mission_cleared"
  | "tool_counted" | "receipt_recorded" | "continuation_requested"
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
  view?: "summary" | "full" | "receipts" | "runs" | "critic" | "iterate";
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
