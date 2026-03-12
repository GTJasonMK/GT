import { isTauri } from "@/platform/runtime";
import { invokeTauri } from "@/platform/tauri";
import { useAgentStore } from "@/store/agentStore";
import { useGraphStore } from "@/store/graphStore";
import type { EdgeColor, LockMode, NodeColor } from "@/types/index.ts";
import { GRAPH_WORKSPACE_MCP_CONTRACT } from "./contract.ts";
import type {
  AgentActor,
  AgentExecutionState,
  GraphPersistenceTarget,
  GraphExportScope,
  GraphImportEnvelope,
  GraphWorkspaceActionResult,
  GraphWorkspaceBridgeStatePayload,
  GraphWorkspaceBridgeStatus,
  GraphWorkspaceSummary,
} from "./types.ts";

interface FallbackRuntimeLike {
  queries: {
    describeActiveWorkspace: () => GraphWorkspaceSummary;
    describePersistenceTarget: () => Promise<GraphPersistenceTarget>;
    getExecutionState: () => AgentExecutionState;
    listPendingApprovals: () => unknown[];
    getMcpContract: () => typeof GRAPH_WORKSPACE_MCP_CONTRACT;
  };
  actions: {
    saveWorkspace: (input?: { actor?: AgentActor; reason?: string }) => Promise<GraphWorkspaceActionResult<unknown>>;
    applyImportedWorkspace: (input: {
      actor?: AgentActor;
      envelope: GraphImportEnvelope;
      replaceExisting?: boolean;
    }) => GraphWorkspaceActionResult<unknown>;
    requestWorkspaceJsonExport: (input: {
      actor: AgentActor;
      scope?: GraphExportScope;
      filename?: string;
      reason?: string;
    }) => Promise<GraphWorkspaceActionResult<unknown>>;
    approveWorkspaceExport: (input: {
      approvalId: string;
      actor?: AgentActor;
    }) => Promise<GraphWorkspaceActionResult<unknown>>;
    rejectWorkspaceExport: (input: {
      approvalId: string;
      actor?: AgentActor;
      reason?: string;
    }) => GraphWorkspaceActionResult<unknown>;
    takeOverSession: (input?: {
      sessionId?: string;
      actor?: AgentActor;
      reason?: string;
    }) => GraphWorkspaceActionResult<unknown>;
  };
  executeTool: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
}

const DISABLED_BRIDGE_STATUS: GraphWorkspaceBridgeStatus = {
  enabled: false,
  source: "web_fallback",
  version: "0.1.0",
  transport: "tauri_loopback_http",
  host: "127.0.0.1",
  port: 0,
  baseUrl: "",
  healthUrl: "",
  contractUrl: "",
  eventsUrl: "",
  manifestPath: "",
  updatedAt: 0,
};

let bridgeStatusCache: GraphWorkspaceBridgeStatus | null = null;

function getSelectedNodeIds(): string[] {
  const state = useGraphStore.getState();
  const selectedIds = state.nodes
    .filter((node) => Boolean(node.selected))
    .map((node) => node.id);

  if (selectedIds.length > 0) {
    return selectedIds;
  }
  return state.selectedNodeId ? [state.selectedNodeId] : [];
}

function buildExecutionState(): AgentExecutionState {
  const state = useAgentStore.getState();
  return {
    latestSessionId: state.latestSessionId,
    sessions: state.sessions,
    tasks: state.tasks,
    approvals: state.approvals,
    events: state.events,
  };
}

async function readBridgeStatus(): Promise<GraphWorkspaceBridgeStatus> {
  if (!isTauri()) {
    return DISABLED_BRIDGE_STATUS;
  }

  try {
    const status = await invokeTauri<GraphWorkspaceBridgeStatus>("bridge_status");
    bridgeStatusCache = status;
    return status;
  } catch (error) {
    console.warn("[agent-bridge] 读取 bridge 状态失败，回退到进程内 runtime。", error);
    return {
      ...DISABLED_BRIDGE_STATUS,
      source: "tauri",
      updatedAt: Date.now(),
    };
  }
}

async function invokeBridge<T>(
  command: "bridge_query" | "bridge_action" | "bridge_approval",
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  return invokeTauri<T>(command, { name, input });
}

function normalizeAppUnavailableResult(): GraphWorkspaceActionResult<never> {
  return {
    ok: false,
    error: {
      code: "APP_UNAVAILABLE",
      message: "本地应用 bridge 当前不可用。",
      retryable: true,
    },
    task: null,
    approval: null,
    events: [],
  };
}

function coerceActor(value: unknown, fallback: AgentActor): AgentActor {
  if (value === "human" || value === "agent" || value === "supervisor" || value === "system") {
    return value;
  }
  return fallback;
}

function coerceExportScope(value: unknown): GraphExportScope {
  return value === "selected" ? "selected" : "all";
}

function successResult<TData>(data: TData): GraphWorkspaceActionResult<TData> {
  return {
    ok: true,
    data,
    task: null,
    approval: null,
    events: [],
  };
}

function applyNodePatchLocally(nodeId: string, patch: {
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
  label?: string;
  content?: string;
  tags?: string[];
  color?: NodeColor;
  edgeColor?: EdgeColor;
  locked?: boolean;
  lockMode?: LockMode;
  lockDepth?: number;
}) {
  const graphStore = useGraphStore.getState();
  if (patch.position) {
    graphStore.onNodesChange([
      {
        id: nodeId,
        type: "position",
        position: patch.position,
      },
    ]);
  }

  const dataPatch: Record<string, unknown> = {
    ...(patch.data ?? {}),
  };
  for (const key of ["label", "content", "tags", "color", "edgeColor", "locked", "lockMode", "lockDepth"] as const) {
    const value = patch[key];
    if (value !== undefined) {
      dataPatch[key] = value;
    }
  }

  if (Object.keys(dataPatch).length > 0) {
    graphStore.updateNodeData(nodeId, dataPatch);
  }
}

export function createGraphCapabilityClient(fallbackRuntime: FallbackRuntimeLike) {
  const readCurrentSummary = () => fallbackRuntime.queries.describeActiveWorkspace();

  const preferBridge = async <T>(args: {
    command: "bridge_query" | "bridge_action" | "bridge_approval";
    name: string;
    input?: Record<string, unknown>;
    fallback: () => Promise<T> | T;
  }): Promise<T> => {
    const status = bridgeStatusCache ?? await readBridgeStatus();
    if (status.enabled) {
      try {
        return await invokeBridge<T>(args.command, args.name, args.input);
      } catch (error) {
        console.warn(`[agent-bridge] ${args.name} 调用失败，回退到进程内 runtime。`, error);
      }
    }
    return await args.fallback();
  };

  const buildBridgeStatePayload = (reason: string): GraphWorkspaceBridgeStatePayload => {
    const graphState = useGraphStore.getState();
    const summary = fallbackRuntime.queries.describeActiveWorkspace();

    return {
      reason,
      workspace: {
        graph: graphState.exportData(),
        selectedNodeId: graphState.selectedNodeId,
        selectedNodeIds: getSelectedNodeIds(),
        saveStatus: graphState.saveStatus,
        revision: summary.revision,
        summary,
      },
      executionState: buildExecutionState(),
      contract: GRAPH_WORKSPACE_MCP_CONTRACT,
    };
  };

  const fallbackCreateNode = (input: {
    actor?: AgentActor;
    label?: string;
    content?: string;
    position?: { x: number; y: number };
  }) => {
    const graphStore = useGraphStore.getState();
    const nodeId = graphStore.addNode(
      input.position ?? { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      input.label,
    );
    graphStore.setSelectedNodeId(nodeId);
    if (input.content) {
      graphStore.updateNodeData(nodeId, { content: input.content });
    }
    return successResult({
      nodeId,
      summary: readCurrentSummary(),
    });
  };

  const fallbackUpdateNode = (input: {
    nodeId: string;
    patch: {
      position?: { x: number; y: number };
      data?: Record<string, unknown>;
      label?: string;
      content?: string;
      tags?: string[];
      color?: NodeColor;
      edgeColor?: EdgeColor;
      locked?: boolean;
      lockMode?: LockMode;
      lockDepth?: number;
    };
  }) => {
    const graphStore = useGraphStore.getState();
    const exists = graphStore.nodes.some((node) => node.id === input.nodeId);
    if (!exists) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: "节点不存在。",
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }
    applyNodePatchLocally(input.nodeId, input.patch);
    return successResult({
      nodeId: input.nodeId,
      summary: readCurrentSummary(),
    });
  };

  const fallbackDeleteNodes = (input: { nodeIds: string[] }) => {
    const graphStore = useGraphStore.getState();
    const uniqueNodeIds = Array.from(new Set(input.nodeIds.filter(Boolean)));
    if (uniqueNodeIds.length === 0) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: "nodeIds 不能为空。",
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }
    uniqueNodeIds.forEach((nodeId) => {
      graphStore.deleteNode(nodeId);
    });
    return successResult({
      deletedNodeCount: uniqueNodeIds.length,
      summary: readCurrentSummary(),
    });
  };

  const fallbackDuplicateNodes = (input: { nodeIds?: string[] }) => {
    const graphStore = useGraphStore.getState();
    const requestedNodeIds = Array.from(new Set((input.nodeIds ?? []).filter(Boolean)));
    if (requestedNodeIds.length <= 1) {
      const targetNodeId = requestedNodeIds[0] ?? graphStore.selectedNodeId ?? null;
      if (!targetNodeId) {
        return {
          ok: false,
          error: {
            code: "PRECONDITION_FAILED" as const,
            message: "请先选中一个或多个节点。",
            retryable: false,
          },
          task: null,
          approval: null,
          events: [],
        };
      }
      const nodeId = graphStore.duplicateNode(targetNodeId);
      if (!nodeId) {
        return {
          ok: false,
          error: {
            code: "PRECONDITION_FAILED" as const,
            message: "选中节点不存在或已被删除。",
            retryable: false,
          },
          task: null,
          approval: null,
          events: [],
        };
      }
      graphStore.setSelectedNodeId(nodeId);
      return successResult({
        nodeIds: [nodeId],
        edgeCount: 0,
        summary: readCurrentSummary(),
      });
    }

    graphStore.nodes.forEach((node) => {
      const shouldSelect = requestedNodeIds.includes(node.id);
      if (Boolean(node.selected) === shouldSelect) return;
      graphStore.onNodesChange([{ id: node.id, type: "select", selected: shouldSelect }]);
    });
    graphStore.setSelectedNodeId(requestedNodeIds[0] ?? null);
    const result = graphStore.duplicateSelectedNodes();
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: result.message,
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }

    return successResult({
      edgeCount: result.edgeCount,
      summary: readCurrentSummary(),
    });
  };

  const fallbackCreateEdge = (input: { source: string; target: string; label?: string }) => {
    const graphStore = useGraphStore.getState();
    const nodeIds = new Set(graphStore.nodes.map((node) => node.id));
    if (!nodeIds.has(input.source) || !nodeIds.has(input.target)) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: "source 或 target 节点不存在。",
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }

    graphStore.onConnect({
      source: input.source,
      target: input.target,
      sourceHandle: null,
      targetHandle: null,
    });
    const nextEdges = useGraphStore.getState().edges;
    const latestEdge = nextEdges[nextEdges.length - 1] ?? null;
    if (latestEdge && input.label) {
      graphStore.updateEdgeLabel(latestEdge.id, input.label);
    }
    return successResult({
      edgeId: latestEdge?.id ?? null,
      summary: readCurrentSummary(),
    });
  };

  const fallbackUpdateEdgeLabel = (input: { edgeId: string; label: string }) => {
    const graphStore = useGraphStore.getState();
    const exists = graphStore.edges.some((edge) => edge.id === input.edgeId);
    if (!exists) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: "连线不存在。",
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }
    graphStore.updateEdgeLabel(input.edgeId, input.label);
    return successResult({
      edgeId: input.edgeId,
      summary: readCurrentSummary(),
    });
  };

  const fallbackDeleteEdges = (input: { edgeIds: string[] }) => {
    const graphStore = useGraphStore.getState();
    const uniqueEdgeIds = Array.from(new Set(input.edgeIds.filter(Boolean)));
    if (uniqueEdgeIds.length === 0) {
      return {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED" as const,
          message: "edgeIds 不能为空。",
          retryable: false,
        },
        task: null,
        approval: null,
        events: [],
      };
    }
    graphStore.onEdgesChange(uniqueEdgeIds.map((edgeId) => ({ id: edgeId, type: "remove" })));
    return successResult({
      deletedEdgeCount: uniqueEdgeIds.length,
      summary: readCurrentSummary(),
    });
  };

  const applyBridgeStatePayload = (payload: GraphWorkspaceBridgeStatePayload) => {
    const graphStore = useGraphStore.getState();
    graphStore.importData(payload.workspace.graph);
    graphStore.setSelectedNodeId(payload.workspace.selectedNodeId ?? payload.workspace.selectedNodeIds[0] ?? null);
    graphStore.setSaveStatus(payload.workspace.saveStatus);
    useAgentStore.getState().replaceExecutionState(payload.executionState);
  };

  const executeFallbackTool = async (name: string, input: Record<string, unknown>) => {
    switch (name) {
      case "import_graph_data":
        return Promise.resolve(fallbackRuntime.actions.applyImportedWorkspace({
          actor: coerceActor(input.actor, "human"),
          envelope: input.envelope as GraphImportEnvelope,
          replaceExisting: Boolean(input.replaceExisting),
        }));
      case "request_json_export":
        return fallbackRuntime.actions.requestWorkspaceJsonExport({
          actor: coerceActor(input.actor, "human"),
          scope: coerceExportScope(input.scope),
          filename: typeof input.filename === "string" ? input.filename : undefined,
          reason: typeof input.reason === "string" ? input.reason : undefined,
        });
      case "approve_pending_action":
        return fallbackRuntime.actions.approveWorkspaceExport({
          approvalId: typeof input.approvalId === "string" ? input.approvalId : "",
          actor: coerceActor(input.actor, "supervisor"),
        });
      case "reject_pending_action":
        return Promise.resolve(fallbackRuntime.actions.rejectWorkspaceExport({
          approvalId: typeof input.approvalId === "string" ? input.approvalId : "",
          actor: coerceActor(input.actor, "supervisor"),
          reason: typeof input.reason === "string" ? input.reason : undefined,
        }));
      case "take_over_session":
        return Promise.resolve(fallbackRuntime.actions.takeOverSession({
          sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
          actor: coerceActor(input.actor, "supervisor"),
          reason: typeof input.reason === "string" ? input.reason : undefined,
        }));
      case "create_node":
        return Promise.resolve(fallbackCreateNode({
          actor: coerceActor(input.actor, "human"),
          label: typeof input.label === "string" ? input.label : undefined,
          content: typeof input.content === "string" ? input.content : undefined,
          position: typeof input.position === "object" && input.position
            ? input.position as { x: number; y: number }
            : undefined,
        }));
      case "update_node":
        return Promise.resolve(fallbackUpdateNode({
          nodeId: typeof input.nodeId === "string" ? input.nodeId : "",
          patch: typeof input.patch === "object" && input.patch ? input.patch as Parameters<typeof fallbackUpdateNode>[0]["patch"] : {},
        }));
      case "delete_nodes":
        return Promise.resolve(fallbackDeleteNodes({
          nodeIds: Array.isArray(input.nodeIds) ? input.nodeIds.filter((value): value is string => typeof value === "string") : [],
        }));
      case "duplicate_nodes":
        return Promise.resolve(fallbackDuplicateNodes({
          nodeIds: Array.isArray(input.nodeIds) ? input.nodeIds.filter((value): value is string => typeof value === "string") : undefined,
        }));
      case "create_edge":
        return Promise.resolve(fallbackCreateEdge({
          source: typeof input.source === "string" ? input.source : "",
          target: typeof input.target === "string" ? input.target : "",
          label: typeof input.label === "string" ? input.label : undefined,
        }));
      case "update_edge_label":
        return Promise.resolve(fallbackUpdateEdgeLabel({
          edgeId: typeof input.edgeId === "string" ? input.edgeId : "",
          label: typeof input.label === "string" ? input.label : "",
        }));
      case "delete_edges":
        return Promise.resolve(fallbackDeleteEdges({
          edgeIds: Array.isArray(input.edgeIds) ? input.edgeIds.filter((value): value is string => typeof value === "string") : [],
        }));
      default:
        return fallbackRuntime.executeTool(name, input);
    }
  };

  return {
    queries: {
      describeActiveWorkspace: fallbackRuntime.queries.describeActiveWorkspace,
      describePersistenceTarget: fallbackRuntime.queries.describePersistenceTarget,
      getExecutionState: fallbackRuntime.queries.getExecutionState,
      listPendingApprovals: fallbackRuntime.queries.listPendingApprovals,
      getMcpContract: fallbackRuntime.queries.getMcpContract,
    },

    actions: {
      saveWorkspace: (input?: { actor?: AgentActor; reason?: string }) =>
        preferBridge({
          command: "bridge_action",
          name: "save_workspace",
          input: input ?? {},
          fallback: () => fallbackRuntime.actions.saveWorkspace(input),
        }),

      applyImportedWorkspace: (input: {
        actor?: AgentActor;
        envelope: GraphImportEnvelope;
        replaceExisting?: boolean;
      }) =>
        preferBridge({
          command: "bridge_action",
          name: "import_graph_data",
          input,
          fallback: () => Promise.resolve(fallbackRuntime.actions.applyImportedWorkspace(input)),
        }),

      requestWorkspaceJsonExport: (input: {
        actor: AgentActor;
        scope?: GraphExportScope;
        filename?: string;
        reason?: string;
      }) =>
        preferBridge({
          command: "bridge_action",
          name: "request_json_export",
          input,
          fallback: () => fallbackRuntime.actions.requestWorkspaceJsonExport(input),
        }),

      approveWorkspaceExport: (input: {
        approvalId: string;
        actor?: AgentActor;
      }) =>
        preferBridge({
          command: "bridge_approval",
          name: "approve_pending_action",
          input,
          fallback: () => fallbackRuntime.actions.approveWorkspaceExport(input),
        }),

      rejectWorkspaceExport: (input: {
        approvalId: string;
        actor?: AgentActor;
        reason?: string;
      }) =>
        preferBridge({
          command: "bridge_approval",
          name: "reject_pending_action",
          input,
          fallback: () => Promise.resolve(fallbackRuntime.actions.rejectWorkspaceExport(input)),
        }),

      takeOverSession: (input?: {
        sessionId?: string;
        actor?: AgentActor;
        reason?: string;
      }) =>
        preferBridge({
          command: "bridge_action",
          name: "take_over_session",
          input: input ?? {},
          fallback: () => Promise.resolve(fallbackRuntime.actions.takeOverSession(input)),
        }),

      createNode: (input: {
        actor?: AgentActor;
        label?: string;
        content?: string;
        position?: { x: number; y: number };
      }) =>
        preferBridge({
          command: "bridge_action",
          name: "create_node",
          input,
          fallback: () => Promise.resolve(fallbackCreateNode(input)),
        }),

      updateNode: (input: {
        nodeId: string;
        patch: {
          position?: { x: number; y: number };
          data?: Record<string, unknown>;
          label?: string;
          content?: string;
          tags?: string[];
          color?: NodeColor;
          edgeColor?: EdgeColor;
          locked?: boolean;
          lockMode?: LockMode;
          lockDepth?: number;
        };
      }) =>
        preferBridge({
          command: "bridge_action",
          name: "update_node",
          input,
          fallback: () => Promise.resolve(fallbackUpdateNode(input)),
        }),

      deleteNodes: (input: { nodeIds: string[]; actor?: AgentActor }) =>
        preferBridge({
          command: "bridge_action",
          name: "delete_nodes",
          input,
          fallback: () => Promise.resolve(fallbackDeleteNodes(input)),
        }),

      duplicateNodes: (input: { nodeIds?: string[]; actor?: AgentActor } = {}) =>
        preferBridge({
          command: "bridge_action",
          name: "duplicate_nodes",
          input,
          fallback: () => Promise.resolve(fallbackDuplicateNodes(input)),
        }),

      createEdge: (input: { source: string; target: string; label?: string; actor?: AgentActor }) =>
        preferBridge({
          command: "bridge_action",
          name: "create_edge",
          input,
          fallback: () => Promise.resolve(fallbackCreateEdge(input)),
        }),

      updateEdgeLabel: (input: { edgeId: string; label: string; actor?: AgentActor }) =>
        preferBridge({
          command: "bridge_action",
          name: "update_edge_label",
          input,
          fallback: () => Promise.resolve(fallbackUpdateEdgeLabel(input)),
        }),

      deleteEdges: (input: { edgeIds: string[]; actor?: AgentActor }) =>
        preferBridge({
          command: "bridge_action",
          name: "delete_edges",
          input,
          fallback: () => Promise.resolve(fallbackDeleteEdges(input)),
        }),
    },

    executeTool: async (name: string, input: Record<string, unknown> = {}) => {
      const tool = GRAPH_WORKSPACE_MCP_CONTRACT.tools.find((item) => item.name === name);
      if (tool) {
        const command = tool.kind === "query" ? "bridge_query" : tool.kind === "approval" ? "bridge_approval" : "bridge_action";
        const status = bridgeStatusCache ?? await readBridgeStatus();
        if (status.enabled) {
          try {
            return await invokeBridge<GraphWorkspaceActionResult<unknown>>(command, name, input);
          } catch (error) {
            console.warn(`[agent-bridge] ${name} tool 调用失败，回退到本地执行。`, error);
          }
        }
      }

      return executeFallbackTool(name, input);
    },

    bridge: {
      getStatus: readBridgeStatus,
      syncState: async (payload: GraphWorkspaceBridgeStatePayload) => {
        if (!isTauri()) return;
        const status = bridgeStatusCache ?? await readBridgeStatus();
        if (!status.enabled) return;
        try {
          await invokeTauri("bridge_sync_state", { snapshot: payload });
        } catch (error) {
          console.warn("[agent-bridge] 推送镜像状态失败。", error);
        }
      },
      buildStatePayload: buildBridgeStatePayload,
      applyStatePayload: applyBridgeStatePayload,
      appUnavailableResult: normalizeAppUnavailableResult,
    },
  };
}
