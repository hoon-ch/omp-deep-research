export type Mode = "web" | "data" | "mixed";
export type Disposition = "conclusive" | "inconclusive";
export type Phase = "active" | "paused" | "completed" | "cancelled";
export type Confidence = "low" | "medium" | "high";
export type RunOutcome = "baseline" | "keep" | "discard" | "crash" | "checks_failed";

/** Operator-chosen settings; they exist before an intake clarifies objective and mode. */
export interface MissionSettings {
  constraints: string[];
  deliverables: string[];
  maxContinuations: number;
  maxToolCalls: number;
  maxMinutes: number;
  allowExec: boolean;
  allowHarness: boolean;
  criticModel?: string;
  primaryModel?: string;
}
export interface MissionConfig extends MissionSettings {
  objective: string;
  mode: Mode;
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
  sourceRefs: string[];
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
  primaryMetric: string;
  direction: "lower" | "higher";
  checksPassed?: boolean;
  notes?: string;
}
export interface Run extends RunInput {
  id: string;
  at: string;
  metrics: Record<string, number>;
  outcome: RunOutcome;
  flagReason?: string;
}
export interface CriticInput {
  evaluator: string;
  receiptId: string;
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
  critics: Critic[];
  verdicts: Verdict[];
  notes: string;
}
export type EventType =
  | "intake_started" | "intake_cancelled"
  | "mission_created" | "pass_resumed" | "pass_paused" | "mission_cancelled" | "mission_cleared"
  | "tool_counted" | "receipt_recorded" | "continuation_requested"
  | "evidence_added" | "run_logged" | "run_flagged" | "notes_updated"
  | "critic_recorded" | "verdict_issued";
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
export interface SessionEntry { type: string; customType?: string; data?: unknown; }
export interface MissionInput {
  objective: string;
  mode: Mode;
  constraints: string[];
  deliverables: string[];
}
export interface ToolInput {
  op: "read" | "start" | "evidence" | "run" | "flag_run" | "notes" | "critic" | "verdict" | "export";
  view?: "summary" | "full" | "receipts" | "critic";
  mission?: MissionInput;
  limit?: number;
  offset?: number;
  requestId?: string;
  evidence?: EvidenceInput;
  run?: RunInput;
  runId?: string;
  reason?: string;
  notes?: string;
  critic?: CriticInput;
  verdict?: VerdictInput;
}
