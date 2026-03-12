import type { GraphData } from "../types/index.ts";
import { GRAPH_WORKSPACE_MCP_CONTRACT } from "./contract.ts";
import { buildWorkspaceSummary } from "./graphWorkspaceSummary.ts";
import type { AgentExecutionTracker } from "./executionTracker.ts";
import type {
  AgentActor,
  AgentApprovalRecord,
  AgentError,
  GraphExportScope,
  GraphImportEnvelope,
  GraphPersistenceTarget,
  GraphWorkspaceActionResult,
  GraphWorkspaceSummary,
} from "./types.ts";

export interface GraphWorkspaceRuntimeDeps {
  tracker: AgentExecutionTracker;
  now?: () => number;
  getWorkspaceReadModel: () => {
    allData: GraphData;
    selectedData: GraphData | null;
    selectedNodeCount: number;
    saveStatus: GraphWorkspaceSummary["saveStatus"];
  };
  saveWorkspace: () => Promise<void>;
  replaceWorkspace: (data: GraphData) => void;
  exportWorkspaceJson: (data: GraphData, filename?: string) => Promise<void>;
  describePersistenceTarget: () => Promise<GraphPersistenceTarget>;
}

function createError(error: AgentError): GraphWorkspaceActionResult<never> {
  return {
    ok: false,
    error,
    task: null,
    approval: null,
    events: [],
  };
}

function narrowRecord(value: Record<string, unknown>): Record<string, unknown> {
  return value;
}

export function createGraphWorkspaceRuntime(deps: GraphWorkspaceRuntimeDeps) {
  const now = deps.now ?? (() => Date.now());

  const queryWorkspace = () => {
    const readModel = deps.getWorkspaceReadModel();
    const summary = buildWorkspaceSummary({
      data: readModel.allData,
      selectedNodeCount: readModel.selectedNodeCount,
      saveStatus: readModel.saveStatus,
    });

    return { readModel, summary };
  };

  const appendEvent = (input: Omit<Parameters<AgentExecutionTracker["appendEvent"]>[0], "timestamp">) => {
    return deps.tracker.appendEvent({
      ...input,
      timestamp: now(),
    });
  };

  const beginTrackedAction = (args: {
    actor: AgentActor;
    actionName: string;
    goal: string;
    step: string;
  }) => {
    const session = deps.tracker.beginSession({
      actor: args.actor,
      goal: args.goal,
      resourceId: "graph_workspace:active",
      status: "active",
      currentAction: args.actionName,
      currentStep: args.step,
    });

    return session;
  };

  const startTask = (args: {
    sessionId: string;
    actionName: string;
    title: string;
    message: string;
    inputSummary?: string;
  }) => {
    const task = deps.tracker.createTask({
      sessionId: args.sessionId,
      actionName: args.actionName,
      resourceId: "graph_workspace:active",
      status: "running",
      title: args.title,
      message: args.message,
      progressPercent: 10,
      inputSummary: args.inputSummary,
    });

    deps.tracker.updateSession(args.sessionId, { taskId: task.id });
    return task;
  };

  const failSessionWithTask = (args: {
    sessionId: string;
    taskId?: string;
    actor: AgentActor;
    eventType: string;
    message: string;
    error: AgentError;
  }) => {
    deps.tracker.updateSession(args.sessionId, {
      status: "aborted",
      endedAt: now(),
      currentStep: "failed",
      lastError: args.error,
    });
    if (args.taskId) {
      deps.tracker.updateTask(args.taskId, {
        status: "failed",
        progressPercent: 100,
        message: args.message,
        completedAt: now(),
        error: args.error,
      });
    }
    const event = appendEvent({
      actor: args.actor,
      level: "error",
      message: args.message,
      type: args.eventType,
      sessionId: args.sessionId,
      taskId: args.taskId,
      resourceId: "graph_workspace:active",
      data: args.error.details,
    });
    return event;
  };

  const completeSessionWithTask = (args: {
    sessionId: string;
    taskId?: string;
    actor: AgentActor;
    eventType: string;
    message: string;
    outputSummary?: string;
  }) => {
    deps.tracker.updateSession(args.sessionId, {
      status: "finished",
      endedAt: now(),
      currentStep: "completed",
    });
    if (args.taskId) {
      deps.tracker.updateTask(args.taskId, {
        status: "succeeded",
        progressPercent: 100,
        message: args.message,
        outputSummary: args.outputSummary,
        completedAt: now(),
      });
    }
    const event = appendEvent({
      actor: args.actor,
      level: "info",
      message: args.message,
      type: args.eventType,
      sessionId: args.sessionId,
      taskId: args.taskId,
      resourceId: "graph_workspace:active",
    });
    return event;
  };

  const createExportApproval = (args: {
    actor: AgentActor;
    scope: GraphExportScope;
    filename?: string;
    reason?: string;
  }): GraphWorkspaceActionResult<{
    summary: GraphWorkspaceSummary;
    scope: GraphExportScope;
  }> => {
    const { readModel, summary } = queryWorkspace();
    const scopedData = args.scope === "selected" ? readModel.selectedData : readModel.allData;
    if (!scopedData) {
      return createError({
        code: "PRECONDITION_FAILED",
        message: "当前没有可导出的选中节点，请先选中节点后再导出。",
        retryable: false,
      });
    }

    const session = beginTrackedAction({
      actor: args.actor,
      actionName: "request_workspace_json_export",
      goal: args.scope === "selected" ? "导出选中子图 JSON" : "导出当前工作区 JSON",
      step: "awaiting_approval",
    });
    const task = deps.tracker.createTask({
      sessionId: session.id,
      actionName: "request_workspace_json_export",
      resourceId: "graph_workspace:active",
      status: "blocked",
      title: args.scope === "selected" ? "导出选中子图 JSON" : "导出工作区 JSON",
      message: "等待人工审批后执行导出。",
      progressPercent: 15,
      inputSummary: `scope=${args.scope}`,
    });
    deps.tracker.updateSession(session.id, { taskId: task.id, status: "paused", currentStep: "pending_approval" });

    const approval = deps.tracker.createApproval({
      sessionId: session.id,
      taskId: task.id,
      actionName: "request_workspace_json_export",
      resourceId: "graph_workspace:active",
      status: "requested",
      title: args.scope === "selected" ? "审批：导出选中子图 JSON" : "审批：导出工作区 JSON",
      riskSummary: "该动作会把当前图谱写出到外部文件系统，属于高风险外部写入。",
      inputSummary: `scope=${args.scope}${args.filename ? `, filename=${args.filename}` : ""}`,
      createdBy: args.actor,
      payload: narrowRecord({
        scope: args.scope,
        filename: args.filename ?? null,
        expectedRevision: summary.revision,
        reason: args.reason ?? "",
      }),
    });
    deps.tracker.updateSession(session.id, { approvalId: approval.id });

    const startedEvent = appendEvent({
      actor: args.actor,
      level: "info",
      message: "已创建受管导出请求。",
      type: "agent.step.started",
      sessionId: session.id,
      taskId: task.id,
      approvalId: approval.id,
      resourceId: "graph_workspace:active",
      data: {
        actionName: "request_workspace_json_export",
        scope: args.scope,
      },
    });
    const blockedEvent = appendEvent({
      actor: args.actor,
      level: "warning",
      message: "导出动作已阻塞，等待人工审批。",
      type: "graph.workspace.export.requires_approval",
      sessionId: session.id,
      taskId: task.id,
      approvalId: approval.id,
      resourceId: "graph_workspace:active",
      data: {
        scope: args.scope,
        revision: summary.revision,
      },
    });

    return {
      ok: false,
      data: {
        summary,
        scope: args.scope,
      },
      task,
      approval,
      events: [startedEvent, blockedEvent],
      error: {
        code: "APPROVAL_REQUIRED",
        message: "导出前需要人工审批。",
        retryable: false,
        details: {
          approvalId: approval.id,
          taskId: task.id,
        },
      },
    };
  };

  const buildWorkspaceSnapshot = () => {
    const { readModel, summary } = queryWorkspace();
    return {
      graph: readModel.allData,
      selectedNodeId: null,
      selectedNodeIds: [],
      saveStatus: readModel.saveStatus,
      revision: summary.revision,
      summary,
    };
  };

  const computeShortestPath = (input: {
    startNodeId: string;
    endNodeId: string;
    mode?: "directed" | "undirected";
  }) => {
    const { allData } = deps.getWorkspaceReadModel();
    const mode = input.mode ?? "directed";
    const validNodeIds = new Set(allData.nodes.map((node) => node.id));
    if (!validNodeIds.has(input.startNodeId) || !validNodeIds.has(input.endNodeId)) {
      return null;
    }

    const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
    allData.edges.forEach((edge) => {
      const sourceItems = adjacency.get(edge.source);
      if (sourceItems) sourceItems.push({ nodeId: edge.target, edgeId: edge.id });
      else adjacency.set(edge.source, [{ nodeId: edge.target, edgeId: edge.id }]);

      if (mode === "undirected") {
        const targetItems = adjacency.get(edge.target);
        if (targetItems) targetItems.push({ nodeId: edge.source, edgeId: edge.id });
        else adjacency.set(edge.target, [{ nodeId: edge.source, edgeId: edge.id }]);
      }
    });

    const queue: string[] = [input.startNodeId];
    const visited = new Set<string>([input.startNodeId]);
    const parent = new Map<string, { nodeId: string; edgeId: string }>();
    let head = 0;

    while (head < queue.length) {
      const currentId = queue[head++]!;
      if (currentId === input.endNodeId) break;

      const neighbors = adjacency.get(currentId) ?? [];
      neighbors.forEach((neighbor) => {
        if (visited.has(neighbor.nodeId)) return;
        visited.add(neighbor.nodeId);
        parent.set(neighbor.nodeId, { nodeId: currentId, edgeId: neighbor.edgeId });
        queue.push(neighbor.nodeId);
      });
    }

    if (!visited.has(input.endNodeId)) {
      return {
        found: false,
        nodeIds: [],
        edgeIds: [],
      };
    }

    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    let currentId: string | null = input.endNodeId;

    while (currentId) {
      nodeIds.push(currentId);
      const previous = parent.get(currentId);
      if (!previous) break;
      edgeIds.push(previous.edgeId);
      currentId = previous.nodeId;
    }

    nodeIds.reverse();
    edgeIds.reverse();
    return {
      found: true,
      nodeIds,
      edgeIds,
    };
  };

  const queries = {
      describeActiveWorkspace() {
        return queryWorkspace().summary;
      },

      async describePersistenceTarget() {
        return deps.describePersistenceTarget();
      },

      getExecutionState() {
        return deps.tracker.getState();
      },

      listPendingApprovals() {
        return deps.tracker.getState().approvals.filter((approval) => approval.status === "requested");
      },

      getWorkspaceSnapshot() {
        return buildWorkspaceSnapshot();
      },

      listNodes() {
        return deps.getWorkspaceReadModel().allData.nodes;
      },

      getNode(nodeId: string) {
        return deps.getWorkspaceReadModel().allData.nodes.find((node) => node.id === nodeId) ?? null;
      },

      listEdges() {
        return deps.getWorkspaceReadModel().allData.edges;
      },

      computeShortestPath(input: {
        startNodeId: string;
        endNodeId: string;
        mode?: "directed" | "undirected";
      }) {
        return computeShortestPath(input);
      },

      getMcpContract() {
        return GRAPH_WORKSPACE_MCP_CONTRACT;
      },
    };

  const actions = {
      async saveWorkspace(input?: {
        actor?: AgentActor;
        reason?: string;
      }): Promise<GraphWorkspaceActionResult<{ summary: GraphWorkspaceSummary }>> {
        const actor = input?.actor ?? "human";
        const session = beginTrackedAction({
          actor,
          actionName: "save_workspace",
          goal: "保存当前工作区",
          step: "persisting_workspace",
        });
        const task = startTask({
          sessionId: session.id,
          actionName: "save_workspace",
          title: "保存当前工作区",
          message: "正在写入持久化后端。",
          inputSummary: input?.reason?.trim() || "manual-save",
        });
        const startedEvent = appendEvent({
          actor,
          level: "info",
          message: "开始保存当前工作区。",
          type: "graph.workspace.save.started",
          sessionId: session.id,
          taskId: task.id,
          resourceId: "graph_workspace:active",
          data: input?.reason ? { reason: input.reason } : undefined,
        });

        try {
          await deps.saveWorkspace();
          const summary = queryWorkspace().summary;
          const completedEvent = completeSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.save.succeeded",
            message: "工作区已保存到持久化后端。",
            outputSummary: `revision=${summary.revision}`,
          });
          return {
            ok: true,
            data: { summary },
            task: deps.tracker.getTask(task.id),
            approval: null,
            events: [startedEvent, completedEvent],
          };
        } catch (error) {
          const failure: AgentError = {
            code: "EXTERNAL_FAILURE",
            message: error instanceof Error ? error.message : "保存工作区失败。",
            retryable: true,
          };
          const failedEvent = failSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.save.failed",
            message: "保存工作区失败。",
            error: failure,
          });
          return {
            ok: false,
            error: failure,
            task: deps.tracker.getTask(task.id),
            approval: null,
            events: [startedEvent, failedEvent],
          };
        }
      },

      applyImportedWorkspace(input: {
        actor?: AgentActor;
        envelope: GraphImportEnvelope;
        replaceExisting?: boolean;
      }): GraphWorkspaceActionResult<{
        summary: GraphWorkspaceSummary;
        warnings: string[];
        source: string;
      }> {
        const actor = input.actor ?? "human";
        const { summary: beforeSummary } = queryWorkspace();
        if (beforeSummary.hasContent && !input.replaceExisting) {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "当前工作区已有内容，导入会覆盖现有图谱，请先确认覆盖。",
            retryable: false,
            details: {
              currentRevision: beforeSummary.revision,
            },
          });
        }

        const session = beginTrackedAction({
          actor,
          actionName: "apply_imported_workspace",
          goal: "替换当前工作区内容",
          step: "applying_imported_workspace",
        });
        const task = startTask({
          sessionId: session.id,
          actionName: "apply_imported_workspace",
          title: "导入图谱到当前工作区",
          message: "正在把导入内容写入活动工作区。",
          inputSummary: `source=${input.envelope.source}`,
        });
        const startedEvent = appendEvent({
          actor,
          level: "info",
          message: "开始导入图谱到当前工作区。",
          type: "graph.workspace.import.started",
          sessionId: session.id,
          taskId: task.id,
          resourceId: "graph_workspace:active",
          data: {
            source: input.envelope.source,
          },
        });

        try {
          deps.replaceWorkspace(input.envelope.graph);
          const summary = queryWorkspace().summary;
          const completedEvent = completeSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.import.succeeded",
            message: `导入完成：${summary.nodeCount} 个节点，${summary.edgeCount} 条连线。`,
            outputSummary: `revision=${summary.revision}`,
          });
          return {
            ok: true,
            data: {
              summary,
              warnings: input.envelope.warnings,
              source: input.envelope.source,
            },
            task: deps.tracker.getTask(task.id),
            approval: null,
            events: [startedEvent, completedEvent],
          };
        } catch (error) {
          const failure: AgentError = {
            code: "EXTERNAL_FAILURE",
            message: error instanceof Error ? error.message : "导入图谱失败。",
            retryable: false,
          };
          const failedEvent = failSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.import.failed",
            message: "导入图谱失败。",
            error: failure,
          });
          return {
            ok: false,
            error: failure,
            task: deps.tracker.getTask(task.id),
            approval: null,
            events: [startedEvent, failedEvent],
          };
        }
      },

      async requestWorkspaceJsonExport(input: {
        actor: AgentActor;
        scope?: GraphExportScope;
        filename?: string;
        reason?: string;
      }): Promise<GraphWorkspaceActionResult<{ summary: GraphWorkspaceSummary; scope: GraphExportScope }>> {
        return createExportApproval({
          actor: input.actor,
          scope: input.scope ?? "all",
          filename: input.filename,
          reason: input.reason,
        });
      },

      async approveWorkspaceExport(input: {
        approvalId: string;
        actor?: AgentActor;
      }): Promise<GraphWorkspaceActionResult<{ summary: GraphWorkspaceSummary; persistence: GraphPersistenceTarget }>> {
        const approval = deps.tracker.getApproval(input.approvalId);
        if (!approval || approval.status !== "requested") {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "审批不存在，或已经不是待处理状态。",
            retryable: false,
          });
        }

        const actor = input.actor ?? "supervisor";
        const session = deps.tracker.getSession(approval.sessionId);
        const task = deps.tracker.getTask(approval.taskId);
        if (!session || !task) {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "审批关联的 session 或 task 已缺失。",
            retryable: false,
          });
        }

        const scope = approval.payload?.scope === "selected" ? "selected" : "all";
        const expectedRevision = typeof approval.payload?.expectedRevision === "string" ? approval.payload.expectedRevision : "";
        const filename = typeof approval.payload?.filename === "string" && approval.payload.filename.trim()
          ? approval.payload.filename
          : undefined;
        const { readModel, summary } = queryWorkspace();
        if (summary.revision !== expectedRevision) {
          const conflict: AgentError = {
            code: "CONCURRENCY_CONFLICT",
            message: "工作区自审批申请后已变化，请重新发起导出。",
            retryable: true,
            details: {
              expectedRevision,
              currentRevision: summary.revision,
            },
          };
          deps.tracker.updateApproval(approval.id, {
            status: "expired",
            resolvedBy: actor,
            resolutionReason: "revision_changed",
          });
          deps.tracker.updateTask(task.id, {
            status: "failed",
            progressPercent: 100,
            message: "审批已失效，工作区 revision 已变化。",
            completedAt: now(),
            error: conflict,
          });
          deps.tracker.updateSession(session.id, {
            status: "aborted",
            endedAt: now(),
            currentStep: "revision_conflict",
            lastError: conflict,
          });
          const event = appendEvent({
            actor,
            level: "error",
            message: "审批已失效，导出前检测到工作区 revision 冲突。",
            type: "graph.workspace.export.failed",
            sessionId: session.id,
            taskId: task.id,
            approvalId: approval.id,
            resourceId: "graph_workspace:active",
            data: conflict.details,
          });
          return {
            ok: false,
            error: conflict,
            task: deps.tracker.getTask(task.id),
            approval: deps.tracker.getApproval(approval.id),
            events: [event],
          };
        }

        const scopedData = scope === "selected" ? readModel.selectedData : readModel.allData;
        if (!scopedData) {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "当前没有可导出的选中节点，请重新选择后再审批。",
            retryable: false,
          });
        }

        deps.tracker.updateApproval(approval.id, {
          status: "approved",
          resolvedBy: actor,
          resolutionReason: "approved_in_operator_panel",
        });
        deps.tracker.updateSession(session.id, {
          status: "active",
          currentStep: "exporting_json",
        });
        deps.tracker.updateTask(task.id, {
          status: "running",
          progressPercent: 45,
          message: "审批通过，开始写出 JSON 文件。",
        });

        const runningEvent = appendEvent({
          actor,
          level: "info",
          message: "审批通过，开始执行 JSON 导出。",
          type: "graph.workspace.export.running",
          sessionId: session.id,
          taskId: task.id,
          approvalId: approval.id,
          resourceId: "graph_workspace:active",
          data: {
            scope,
            revision: summary.revision,
          },
        });

        try {
          await deps.exportWorkspaceJson(scopedData, filename);
          const persistence = await deps.describePersistenceTarget();
          const completedEvent = completeSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.export.succeeded",
            message: "JSON 导出已完成。",
            outputSummary: `scope=${scope}`,
          });
          return {
            ok: true,
            data: {
              summary,
              persistence,
            },
            task: deps.tracker.getTask(task.id),
            approval: deps.tracker.getApproval(approval.id),
            events: [runningEvent, completedEvent],
          };
        } catch (error) {
          const failure: AgentError = {
            code: "EXTERNAL_FAILURE",
            message: error instanceof Error ? error.message : "JSON 导出失败。",
            retryable: true,
          };
          const failedEvent = failSessionWithTask({
            actor,
            sessionId: session.id,
            taskId: task.id,
            eventType: "graph.workspace.export.failed",
            message: "JSON 导出失败。",
            error: failure,
          });
          return {
            ok: false,
            error: failure,
            task: deps.tracker.getTask(task.id),
            approval: deps.tracker.getApproval(approval.id),
            events: [runningEvent, failedEvent],
          };
        }
      },

      rejectWorkspaceExport(input: {
        approvalId: string;
        actor?: AgentActor;
        reason?: string;
      }): GraphWorkspaceActionResult<{ approval: AgentApprovalRecord }> {
        const approval = deps.tracker.getApproval(input.approvalId);
        if (!approval || approval.status !== "requested") {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "审批不存在，或已经不是待处理状态。",
            retryable: false,
          });
        }

        const actor = input.actor ?? "supervisor";
        deps.tracker.updateApproval(approval.id, {
          status: "rejected",
          resolvedBy: actor,
          resolutionReason: input.reason ?? "operator_rejected",
        });
        deps.tracker.updateTask(approval.taskId, {
          status: "cancelled",
          progressPercent: 100,
          message: "审批被拒绝，导出已取消。",
          completedAt: now(),
        });
        deps.tracker.updateSession(approval.sessionId, {
          status: "aborted",
          endedAt: now(),
          currentStep: "approval_rejected",
        });

        const event = appendEvent({
          actor,
          level: "warning",
          message: "导出审批被拒绝，任务已取消。",
          type: "graph.workspace.export.failed",
          sessionId: approval.sessionId,
          taskId: approval.taskId,
          approvalId: approval.id,
          resourceId: "graph_workspace:active",
          data: input.reason ? { reason: input.reason } : undefined,
        });

        return {
          ok: true,
          data: {
            approval: deps.tracker.getApproval(approval.id)!,
          },
          task: deps.tracker.getTask(approval.taskId),
          approval: deps.tracker.getApproval(approval.id),
          events: [event],
        };
      },

      takeOverSession(input?: {
        sessionId?: string;
        actor?: AgentActor;
        reason?: string;
      }): GraphWorkspaceActionResult<{ sessionId: string }> {
        const actor = input?.actor ?? "supervisor";
        const state = deps.tracker.getState();
        const session = input?.sessionId
          ? state.sessions.find((item) => item.id === input.sessionId) ?? null
          : state.latestSessionId
            ? state.sessions.find((item) => item.id === state.latestSessionId) ?? null
            : null;

        if (!session) {
          return createError({
            code: "PRECONDITION_FAILED",
            message: "当前没有可接管的 session。",
            retryable: false,
          });
        }

        deps.tracker.updateSession(session.id, {
          status: "taken_over",
          endedAt: now(),
          currentStep: "taken_over_by_human",
        });

        const event = appendEvent({
          actor,
          level: "warning",
          message: input?.reason?.trim() || "人工已接管当前 session。",
          type: "agent.session.taken_over",
          sessionId: session.id,
          taskId: session.taskId,
          approvalId: session.approvalId,
          resourceId: session.resourceId,
        });

        return {
          ok: true,
          data: { sessionId: session.id },
          task: session.taskId ? deps.tracker.getTask(session.taskId) : null,
          approval: session.approvalId ? deps.tracker.getApproval(session.approvalId) : null,
          events: [event],
        };
      },
    };

  const executeTool = async (name: string, input: Record<string, unknown> = {}) => {
      switch (name) {
        case "describe_active_workspace":
          return {
            ok: true,
            data: queries.describeActiveWorkspace(),
          };
        case "describe_persistence_target":
          return {
            ok: true,
            data: await queries.describePersistenceTarget(),
          };
        case "get_execution_state":
          return {
            ok: true,
            data: queries.getExecutionState(),
          };
        case "list_pending_approvals":
          return {
            ok: true,
            data: queries.listPendingApprovals(),
          };
        case "get_workspace_snapshot":
          return {
            ok: true,
            data: queries.getWorkspaceSnapshot(),
          };
        case "list_nodes":
          return {
            ok: true,
            data: queries.listNodes(),
          };
        case "get_node": {
          const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
          const node = queries.getNode(nodeId);
          if (!node) {
            return createError({
              code: "PRECONDITION_FAILED",
              message: "节点不存在。",
              retryable: false,
            });
          }
          return {
            ok: true,
            data: node,
          };
        }
        case "list_edges":
          return {
            ok: true,
            data: queries.listEdges(),
          };
        case "compute_shortest_path": {
          const result = queries.computeShortestPath({
            startNodeId: typeof input.startNodeId === "string" ? input.startNodeId : "",
            endNodeId: typeof input.endNodeId === "string" ? input.endNodeId : "",
            mode: input.mode === "undirected" ? "undirected" : "directed",
          });
          if (!result) {
            return createError({
              code: "PRECONDITION_FAILED",
              message: "起点或终点节点不存在。",
              retryable: false,
            });
          }
          return {
            ok: true,
            data: result,
          };
        }
        case "save_workspace": {
          const result = await actions.saveWorkspace({
            actor: input.actor === "agent" || input.actor === "system" ? input.actor : "human",
            reason: typeof input.reason === "string" ? input.reason : undefined,
          });
          return result;
        }
        case "import_graph_data":
        case "request_workspace_json_export": {
          const isImport = name === "import_graph_data";
          if (isImport) {
            return actions.applyImportedWorkspace({
              actor: input.actor === "agent" || input.actor === "system" || input.actor === "human"
                ? input.actor
                : "human",
              envelope: input.envelope as GraphImportEnvelope,
              replaceExisting: Boolean(input.replaceExisting),
            });
          }
          const result = await actions.requestWorkspaceJsonExport({
            actor: input.actor === "agent" ? "agent" : "human",
            scope: input.scope === "selected" ? "selected" : "all",
            filename: typeof input.filename === "string" ? input.filename : undefined,
            reason: typeof input.reason === "string" ? input.reason : undefined,
          });
          return result;
        }
        case "request_json_export": {
          const result = await actions.requestWorkspaceJsonExport({
            actor: input.actor === "agent" ? "agent" : "human",
            scope: input.scope === "selected" ? "selected" : "all",
            filename: typeof input.filename === "string" ? input.filename : undefined,
            reason: typeof input.reason === "string" ? input.reason : undefined,
          });
          return result;
        }
        case "approve_pending_action":
        case "approve_workspace_export": {
          const result = await actions.approveWorkspaceExport({
            approvalId: typeof input.approvalId === "string" ? input.approvalId : "",
            actor: input.actor === "human" ? "human" : "supervisor",
          });
          return result;
        }
        case "reject_pending_action":
        case "reject_workspace_export": {
          const result = actions.rejectWorkspaceExport({
            approvalId: typeof input.approvalId === "string" ? input.approvalId : "",
            actor: input.actor === "human" ? "human" : "supervisor",
            reason: typeof input.reason === "string" ? input.reason : undefined,
          });
          return result;
        }
        case "take_over_session":
        case "take_over_current_session": {
          return actions.takeOverSession({
            sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
            actor: input.actor === "human" ? "human" : "supervisor",
            reason: typeof input.reason === "string" ? input.reason : undefined,
          });
        }
        default:
          return {
            ok: false,
            error: {
              code: "VALIDATION_FAILED",
              message: `未知工具：${name}`,
              retryable: false,
            },
          };
      }
    };

  return {
    queries,
    actions,
    executeTool,
  };
}
