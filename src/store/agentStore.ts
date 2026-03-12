import { create } from "zustand";
import type {
  AgentApprovalRecord,
  AgentEventRecord,
  AgentExecutionState,
  AgentSessionRecord,
  AgentTaskRecord,
} from "@/agent/types.ts";
import type { AgentExecutionTracker } from "@/agent/executionTracker.ts";

interface AgentStoreState extends AgentExecutionState {
  operatorPanelOpen: boolean;
  setOperatorPanelOpen: (open: boolean) => void;
  clearExecutionState: () => void;
  replaceExecutionState: (state: AgentExecutionState) => void;
  beginSession: (input: Omit<AgentSessionRecord, "id" | "createdAt" | "updatedAt">) => AgentSessionRecord;
  updateSession: (
    sessionId: string,
    patch: Partial<Omit<AgentSessionRecord, "id" | "createdAt">>,
  ) => AgentSessionRecord | null;
  getSession: (sessionId: string) => AgentSessionRecord | null;
  createTask: (input: Omit<AgentTaskRecord, "id" | "createdAt" | "updatedAt">) => AgentTaskRecord;
  updateTask: (
    taskId: string,
    patch: Partial<Omit<AgentTaskRecord, "id" | "sessionId" | "createdAt">>,
  ) => AgentTaskRecord | null;
  getTask: (taskId: string) => AgentTaskRecord | null;
  createApproval: (input: Omit<AgentApprovalRecord, "id" | "createdAt" | "updatedAt">) => AgentApprovalRecord;
  updateApproval: (
    approvalId: string,
    patch: Partial<Omit<AgentApprovalRecord, "id" | "sessionId" | "taskId" | "createdAt">>,
  ) => AgentApprovalRecord | null;
  getApproval: (approvalId: string) => AgentApprovalRecord | null;
  appendEvent: (input: Omit<AgentEventRecord, "id">) => AgentEventRecord;
}

const MAX_SESSION_COUNT = 10;
const MAX_TASK_COUNT = 12;
const MAX_APPROVAL_COUNT = 12;
const MAX_EVENT_COUNT = 60;

function createId(prefix: string, counter: number): string {
  return `${prefix}_${counter.toString(36).padStart(4, "0")}`;
}

function trimStateSlice<T>(items: T[], limit: number): T[] {
  return items.slice(-limit);
}

export const useAgentStore = create<AgentStoreState>((set, get) => {
  let sessionCounter = 1;
  let taskCounter = 1;
  let approvalCounter = 1;
  let eventCounter = 1;

  const updateRecord = <TRecord extends { id: string; updatedAt?: number }>(
    items: TRecord[],
    id: string,
    patch: Partial<TRecord>,
  ): TRecord | null => {
    const targetIndex = items.findIndex((item) => item.id === id);
    if (targetIndex < 0) return null;

    const nextRecord = {
      ...(items[targetIndex] as TRecord),
      ...patch,
      updatedAt: Date.now(),
    } as TRecord;
    items.splice(targetIndex, 1, nextRecord);
    return nextRecord;
  };

  return {
    latestSessionId: null,
    sessions: [] as AgentSessionRecord[],
    tasks: [] as AgentTaskRecord[],
    approvals: [] as AgentApprovalRecord[],
    events: [] as AgentEventRecord[],
    operatorPanelOpen: true,

    setOperatorPanelOpen: (open) => set({ operatorPanelOpen: open }),

    clearExecutionState: () =>
      set({
        latestSessionId: null,
        sessions: [],
        tasks: [],
        approvals: [],
        events: [],
      }),

    replaceExecutionState: (state) =>
      set({
        latestSessionId: state.latestSessionId,
        sessions: state.sessions,
        tasks: state.tasks,
        approvals: state.approvals,
        events: state.events,
      }),

    beginSession: (input) => {
      const timestamp = Date.now();
      const record: AgentSessionRecord = {
        id: createId("session", sessionCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      set((state) => ({
        latestSessionId: record.id,
        sessions: trimStateSlice([...state.sessions, record], MAX_SESSION_COUNT),
      }));
      return record;
    },

    updateSession: (sessionId, patch) => {
      const state = get();
      const sessions = [...state.sessions];
      const record = updateRecord<AgentSessionRecord>(sessions, sessionId, patch as Partial<AgentSessionRecord>);
      if (!record) return null;
      set({
        sessions,
        latestSessionId: record.id,
      });
      return record;
    },

    getSession: (sessionId) => get().sessions.find((session) => session.id === sessionId) ?? null,

    createTask: (input) => {
      const timestamp = Date.now();
      const record: AgentTaskRecord = {
        id: createId("task", taskCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      set((state) => ({
        tasks: trimStateSlice([...state.tasks, record], MAX_TASK_COUNT),
      }));
      return record;
    },

    updateTask: (taskId, patch) => {
      const state = get();
      const tasks = [...state.tasks];
      const record = updateRecord<AgentTaskRecord>(tasks, taskId, patch as Partial<AgentTaskRecord>);
      if (!record) return null;
      set({ tasks });
      return record;
    },

    getTask: (taskId) => get().tasks.find((task) => task.id === taskId) ?? null,

    createApproval: (input) => {
      const timestamp = Date.now();
      const record: AgentApprovalRecord = {
        id: createId("approval", approvalCounter++),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
      set((state) => ({
        approvals: trimStateSlice([...state.approvals, record], MAX_APPROVAL_COUNT),
      }));
      return record;
    },

    updateApproval: (approvalId, patch) => {
      const state = get();
      const approvals = [...state.approvals];
      const record = updateRecord<AgentApprovalRecord>(approvals, approvalId, patch as Partial<AgentApprovalRecord>);
      if (!record) return null;
      set({ approvals });
      return record;
    },

    getApproval: (approvalId) => get().approvals.find((approval) => approval.id === approvalId) ?? null,

    appendEvent: (input) => {
      const record: AgentEventRecord = {
        id: createId("event", eventCounter++),
        ...input,
      };
      set((state) => ({
        events: trimStateSlice([...state.events, record], MAX_EVENT_COUNT),
      }));
      return record;
    },
  };
});

export const agentExecutionStoreTracker: AgentExecutionTracker = {
  beginSession: (input) => useAgentStore.getState().beginSession(input),
  updateSession: (sessionId, patch) => useAgentStore.getState().updateSession(sessionId, patch),
  getSession: (sessionId) => useAgentStore.getState().getSession(sessionId),
  createTask: (input) => useAgentStore.getState().createTask(input),
  updateTask: (taskId, patch) => useAgentStore.getState().updateTask(taskId, patch),
  getTask: (taskId) => useAgentStore.getState().getTask(taskId),
  createApproval: (input) => useAgentStore.getState().createApproval(input),
  updateApproval: (approvalId, patch) => useAgentStore.getState().updateApproval(approvalId, patch),
  getApproval: (approvalId) => useAgentStore.getState().getApproval(approvalId),
  appendEvent: (input) => useAgentStore.getState().appendEvent(input),
  getState: () => {
    const state = useAgentStore.getState();
    return {
      latestSessionId: state.latestSessionId,
      sessions: state.sessions,
      tasks: state.tasks,
      approvals: state.approvals,
      events: state.events,
    };
  },
};
