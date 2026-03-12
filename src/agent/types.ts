import type { GraphData } from "../types/index.ts";

export type AgentActor = "human" | "agent" | "supervisor" | "system";

export type AgentSessionStatus = "planned" | "active" | "paused" | "finished" | "taken_over" | "aborted";

export type AgentTaskStatus = "pending" | "running" | "blocked" | "succeeded" | "failed" | "cancelled";

export type AgentApprovalStatus = "requested" | "approved" | "rejected" | "expired";

export type AgentEventLevel = "info" | "warning" | "error";

export type AgentErrorCode =
  | "VALIDATION_FAILED"
  | "PRECONDITION_FAILED"
  | "CONCURRENCY_CONFLICT"
  | "EXTERNAL_FAILURE"
  | "APPROVAL_REQUIRED"
  | "APP_UNAVAILABLE";

export type GraphExportScope = "all" | "selected";

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface GraphWorkspaceSummary {
  resourceId: "graph_workspace:active";
  revision: string;
  nodeCount: number;
  edgeCount: number;
  selectedNodeCount: number;
  saveStatus: "idle" | "saving" | "saved";
  hasContent: boolean;
  lastUpdatedAt: number | null;
}

export interface GraphPersistenceTarget {
  backend: "tauri_file" | "local_storage";
  location: string;
  exists: boolean;
  byteSize: number;
  updatedAt: number | null;
}

export interface GraphWorkspaceSnapshot {
  graph: GraphData;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  saveStatus: GraphWorkspaceSummary["saveStatus"];
  revision: string;
  summary: GraphWorkspaceSummary;
}

export interface AgentEventRecord {
  id: string;
  type: string;
  level: AgentEventLevel;
  message: string;
  timestamp: number;
  sessionId?: string;
  taskId?: string;
  approvalId?: string;
  resourceId?: string;
  actor?: AgentActor;
  data?: Record<string, unknown>;
}

export interface AgentTaskRecord {
  id: string;
  sessionId: string;
  actionName: string;
  resourceId: string;
  status: AgentTaskStatus;
  title: string;
  message: string;
  progressPercent: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: AgentError;
}

export interface AgentApprovalRecord {
  id: string;
  sessionId: string;
  taskId: string;
  actionName: string;
  resourceId: string;
  status: AgentApprovalStatus;
  title: string;
  riskSummary: string;
  inputSummary: string;
  createdBy: AgentActor;
  createdAt: number;
  updatedAt: number;
  resolvedBy?: AgentActor;
  resolutionReason?: string;
  payload?: Record<string, unknown>;
}

export interface AgentSessionRecord {
  id: string;
  goal: string;
  resourceId: string;
  actor: AgentActor;
  status: AgentSessionStatus;
  currentAction: string;
  currentStep: string;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  taskId?: string;
  approvalId?: string;
  lastError?: AgentError;
}

export interface AgentExecutionState {
  latestSessionId: string | null;
  sessions: AgentSessionRecord[];
  tasks: AgentTaskRecord[];
  approvals: AgentApprovalRecord[];
  events: AgentEventRecord[];
}

export interface GraphImportEnvelope {
  graph: GraphData;
  source: string;
  warnings: string[];
}

export interface GraphWorkspaceActionResult<TData = unknown> {
  ok: boolean;
  data?: TData;
  task?: AgentTaskRecord | null;
  approval?: AgentApprovalRecord | null;
  events?: AgentEventRecord[];
  error?: AgentError;
}

export interface AgentToolSchema {
  name: string;
  kind: "query" | "action" | "approval";
  goal: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  preconditions: string[];
  sideEffects: string[];
  idempotency: "idempotent" | "conditionally_idempotent" | "not_idempotent";
  confirmationRequirement: "none" | "human_confirmation_required" | "human_approval_required";
  failureModes: AgentErrorCode[];
  observableEvents: string[];
  visibility: "safe_by_default" | "guarded";
}

export interface GraphWorkspaceCapabilityModel {
  resource: {
    name: string;
    description: string;
    stableId: string;
  };
  queries: string[];
  actions: string[];
  approvals: string[];
  tasks: string[];
  events: string[];
}

export interface GraphWorkspaceMcpContract {
  version: string;
  resource: GraphWorkspaceCapabilityModel["resource"];
  tools: AgentToolSchema[];
}

export interface GraphWorkspaceBridgeManifest {
  version: string;
  transport: "tauri_loopback_http";
  host: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
  contractUrl: string;
  eventsUrl: string;
  manifestPath: string;
  updatedAt: number;
}

export interface GraphWorkspaceBridgeStatus extends GraphWorkspaceBridgeManifest {
  enabled: boolean;
  source: "tauri" | "web_fallback";
}

export interface GraphWorkspaceBridgeStatePayload {
  reason: string;
  workspace: GraphWorkspaceSnapshot;
  executionState: AgentExecutionState;
  contract: GraphWorkspaceMcpContract;
}
