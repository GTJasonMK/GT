import type {
  AgentApprovalRecord,
  AgentApprovalStatus,
  AgentEventRecord,
  AgentExecutionState,
  AgentSessionRecord,
  AgentSessionStatus,
  AgentTaskRecord,
  AgentTaskStatus,
} from "./types.ts";

export interface AgentExecutionTracker {
  beginSession(input: Omit<AgentSessionRecord, "id" | "createdAt" | "updatedAt">): AgentSessionRecord;
  updateSession(
    sessionId: string,
    patch: Partial<Omit<AgentSessionRecord, "id" | "createdAt">>,
  ): AgentSessionRecord | null;
  getSession(sessionId: string): AgentSessionRecord | null;
  createTask(input: Omit<AgentTaskRecord, "id" | "createdAt" | "updatedAt">): AgentTaskRecord;
  updateTask(taskId: string, patch: Partial<Omit<AgentTaskRecord, "id" | "sessionId" | "createdAt">>): AgentTaskRecord | null;
  getTask(taskId: string): AgentTaskRecord | null;
  createApproval(input: Omit<AgentApprovalRecord, "id" | "createdAt" | "updatedAt">): AgentApprovalRecord;
  updateApproval(
    approvalId: string,
    patch: Partial<Omit<AgentApprovalRecord, "id" | "sessionId" | "taskId" | "createdAt">>,
  ): AgentApprovalRecord | null;
  getApproval(approvalId: string): AgentApprovalRecord | null;
  appendEvent(input: Omit<AgentEventRecord, "id">): AgentEventRecord;
  getState(): AgentExecutionState;
}

function updateRecord<TRecord extends { id: string; updatedAt?: number }>(
  items: TRecord[],
  id: string,
  patch: Partial<TRecord>,
  now: number,
): TRecord | null {
  const targetIndex = items.findIndex((item) => item.id === id);
  if (targetIndex < 0) return null;

  const nextRecord = {
    ...(items[targetIndex] as TRecord),
    ...patch,
    updatedAt: now,
  } as TRecord;
  items.splice(targetIndex, 1, nextRecord);
  return nextRecord;
}

function createId(prefix: string, counter: number): string {
  return `${prefix}_${counter.toString(36).padStart(4, "0")}`;
}

export function createInMemoryExecutionTracker(now: () => number = () => Date.now()): AgentExecutionTracker {
  const state: AgentExecutionState = {
    latestSessionId: null,
    sessions: [] as AgentSessionRecord[],
    tasks: [] as AgentTaskRecord[],
    approvals: [] as AgentApprovalRecord[],
    events: [] as AgentEventRecord[],
  };

  let sessionCounter = 1;
  let taskCounter = 1;
  let approvalCounter = 1;
  let eventCounter = 1;

  const trimState = () => {
    state.sessions = state.sessions.slice(-10);
    state.tasks = state.tasks.slice(-12);
    state.approvals = state.approvals.slice(-12);
    state.events = state.events.slice(-60);
  };

  return {
    beginSession(input) {
      const timestamp = now();
      const record: AgentSessionRecord = {
        id: createId("session", sessionCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      state.sessions = [...state.sessions, record];
      state.latestSessionId = record.id;
      trimState();
      return record;
    },

    updateSession(sessionId, patch) {
      const record = updateRecord<AgentSessionRecord>(state.sessions, sessionId, patch as Partial<AgentSessionRecord>, now());
      if (record) {
        state.latestSessionId = record.id;
      }
      return record;
    },

    getSession(sessionId) {
      return state.sessions.find((session) => session.id === sessionId) ?? null;
    },

    createTask(input) {
      const timestamp = now();
      const record: AgentTaskRecord = {
        id: createId("task", taskCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      state.tasks = [...state.tasks, record];
      trimState();
      return record;
    },

    updateTask(taskId, patch) {
      return updateRecord<AgentTaskRecord>(state.tasks, taskId, patch as Partial<AgentTaskRecord>, now());
    },

    getTask(taskId) {
      return state.tasks.find((task) => task.id === taskId) ?? null;
    },

    createApproval(input) {
      const timestamp = now();
      const record: AgentApprovalRecord = {
        id: createId("approval", approvalCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      state.approvals = [...state.approvals, record];
      trimState();
      return record;
    },

    updateApproval(approvalId, patch) {
      return updateRecord<AgentApprovalRecord>(state.approvals, approvalId, patch as Partial<AgentApprovalRecord>, now());
    },

    getApproval(approvalId) {
      return state.approvals.find((approval) => approval.id === approvalId) ?? null;
    },

    appendEvent(input) {
      const record: AgentEventRecord = {
        id: createId("event", eventCounter++),
        ...input,
      };
      state.events = [...state.events, record];
      trimState();
      return record;
    },

    getState() {
      return {
        latestSessionId: state.latestSessionId,
        sessions: [...state.sessions],
        tasks: [...state.tasks],
        approvals: [...state.approvals],
        events: [...state.events],
      };
    },
  };
}

export function isTaskTerminal(status: AgentTaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function isSessionTerminal(status: AgentSessionStatus): boolean {
  return status === "finished" || status === "taken_over" || status === "aborted";
}

export function isApprovalTerminal(status: AgentApprovalStatus): boolean {
  return status === "approved" || status === "rejected" || status === "expired";
}
