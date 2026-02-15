import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { temporal } from "zundo";
import {
  type Node,
  type Edge,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
} from "@xyflow/react";
import { EDGE_IMPORTANCE_RANKS, type KnowledgeNodeData, type GraphData, type EdgeColor, type LockMode, type NodeColor } from "@/types";
import { type AutoLayoutOptions, computeAutoLayoutPositions } from "@/lib/graphAutoLayout";
import { clampLockDepth, normalizeEdgeColor, normalizeTagList } from "@/lib/graphDataUtils";
import { createPathFocusSlice } from "@/store/slices/createPathFocusSlice";
import { createSearchSlice } from "@/store/slices/createSearchSlice";
import { createEdgeSlice } from "@/store/slices/createEdgeSlice";
import { createPersistenceSlice } from "@/store/slices/createPersistenceSlice";
import { prunePathFocusState, recomputeSearchResults, resolveNextSelectedNodeId, resolveSelectedNodeIds } from "@/store/slices/graphHelpers";

// 生成唯一 ID
const generateId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;
export type GraphEdge = Edge;

export interface BatchNodeEditPayload {
  color?: NodeColor;
  edgeColor?: EdgeColor;
  appendTags?: string[];
  replaceTags?: string[];
  lock?: {
    enabled: boolean;
    mode?: LockMode;
    depth?: number;
  };
}

export interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  pathFocusNodeIds: string[];
  pathFocusEdgeIds: string[];
  pathFocusMode: "directed" | "undirected" | null;
  saveStatus: "idle" | "saving" | "saved";
  searchQuery: string;
  searchResults: string[];

  // ReactFlow 事件处理
  onNodesChange: OnNodesChange<GraphNode>;
  onEdgesChange: OnEdgesChange<GraphEdge>;
  onConnect: OnConnect;

  // 节点操作
  addNode: (position: { x: number; y: number }, label?: string) => string;
  updateNodeData: (nodeId: string, data: Partial<KnowledgeNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => string | null;
  setSelectedNodeId: (nodeId: string | null) => void;
  setNodeEdgeColor: (nodeId: string, edgeColor: EdgeColor) => void;
  propagateEdgeColorFromNode: (nodeId: string) => void;
  autoLayoutFromNode: (nodeId: string, options?: AutoLayoutOptions) => { ok: boolean; crossings: number };
  beginDragHistoryBatch: () => void;
  endDragHistoryBatch: () => void;
  toggleNodeLock: (nodeId: string, lockMode?: LockMode, lockDepth?: number) => void;
  getConnectedNodeIds: (nodeId: string, lockMode?: LockMode, lockDepth?: number) => string[];
  applyBatchEditToSelectedNodes: (payload: BatchNodeEditPayload) => { ok: boolean; count: number; message: string };
  focusShortestPathBetweenSelectedNodes: () => { ok: boolean; message: string };
  clearPathFocus: () => void;
  markSaveStatusIdle: () => void;

  // 搜索
  setSearchQuery: (query: string) => void;

  // 边操作
  updateEdgeLabel: (edgeId: string, label: string) => void;

  // 数据持久化
  saveData: () => Promise<void>;
  loadData: () => Promise<void>;
  exportData: () => GraphData;
  exportSelectedNodesData: () => GraphData | null;
  exportSelectedSubgraphData: () => GraphData | null;
  importData: (data: GraphData) => void;
}

export const useGraphStore = create<GraphStore>()(
  subscribeWithSelector(
    temporal(
      (set, get, store) => {
        const temporalApi = (store as unknown as { temporal: { getState: () => { pause: () => void; resume: () => void } } }).temporal;

        // 拖拽过程中会高频触发 nodes 更新，默认会把每一帧都写入撤销栈，造成卡顿且撤销体验差。
        // 这里做“拖拽批处理”：允许第一帧写入撤销栈（记录拖拽前状态），随后暂停追踪，直到拖拽结束再恢复。
        let shouldPauseHistoryAfterNextUpdate = false;
        let isHistoryPausedByDrag = false;
        let latestSaveRequestId = 0;

        const pauseHistoryTrackingIfRequested = () => {
          if (!shouldPauseHistoryAfterNextUpdate) return;
          shouldPauseHistoryAfterNextUpdate = false;
          temporalApi.getState().pause();
          isHistoryPausedByDrag = true;
        };

        const resumeHistoryTrackingIfPaused = () => {
          if (!isHistoryPausedByDrag) return;
          temporalApi.getState().resume();
          isHistoryPausedByDrag = false;
        };

        return {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        pathFocusNodeIds: [],
        pathFocusEdgeIds: [],
        pathFocusMode: null,
        saveStatus: "idle" as const,
        searchQuery: "",
        searchResults: [],

        onNodesChange: (changes) => {
          set((state) => {
            const nextNodes = applyNodeChanges(changes, state.nodes);
            return {
              nodes: nextNodes,
              searchResults: recomputeSearchResults(nextNodes, state.searchQuery),
              selectedNodeId: resolveNextSelectedNodeId(nextNodes, state.selectedNodeId),
              ...prunePathFocusState({
                pathFocusNodeIds: state.pathFocusNodeIds,
                pathFocusEdgeIds: state.pathFocusEdgeIds,
                pathFocusMode: state.pathFocusMode,
                validNodeIds: new Set(nextNodes.map((node) => node.id)),
                validEdgeIds: new Set(state.edges.map((edge) => edge.id)),
              }),
            };
          });
          pauseHistoryTrackingIfRequested();
        },

        onEdgesChange: (changes) => {
          set((state) => {
            const nextEdges = applyEdgeChanges(changes, state.edges);
            return {
              edges: nextEdges,
              ...prunePathFocusState({
                pathFocusNodeIds: state.pathFocusNodeIds,
                pathFocusEdgeIds: state.pathFocusEdgeIds,
                pathFocusMode: state.pathFocusMode,
                validNodeIds: new Set(state.nodes.map((node) => node.id)),
                validEdgeIds: new Set(nextEdges.map((edge) => edge.id)),
              }),
            };
          });
          pauseHistoryTrackingIfRequested();
        },

        onConnect: (connection) => {
          set((state) => {
            const nextEdges = addEdge({ ...connection, type: "centerEdge" }, state.edges);
            return {
              edges: nextEdges,
              ...prunePathFocusState({
                pathFocusNodeIds: state.pathFocusNodeIds,
                pathFocusEdgeIds: state.pathFocusEdgeIds,
                pathFocusMode: state.pathFocusMode,
                validNodeIds: new Set(state.nodes.map((node) => node.id)),
                validEdgeIds: new Set(nextEdges.map((edge) => edge.id)),
              }),
            };
          });
        },

        addNode: (position, label) => {
          const id = generateId();
          const now = Date.now();
          const newNode: GraphNode = {
            id,
            type: "knowledgeNode" as const,
            position,
            dragHandle: ".node-drag-handle",
            data: {
              label: label || "新知识点",
              content: "",
              tags: [],
              createdAt: now,
              updatedAt: now,
            } satisfies KnowledgeNodeData,
          };
          set((state) => {
            const nextNodes = [...state.nodes, newNode];
            return {
              nodes: nextNodes,
              searchResults: recomputeSearchResults(nextNodes, state.searchQuery),
            };
          });
          return id;
        },

        updateNodeData: (nodeId, data) => {
          set((state) => {
            const nextNodes = state.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              return {
                ...node,
                data: { ...node.data, ...data, updatedAt: Date.now() },
              };
            });
            return {
              nodes: nextNodes,
              searchResults: recomputeSearchResults(nextNodes, state.searchQuery),
            };
          });
        },

        deleteNode: (nodeId) => {
          set((state) => {
            const nextNodes = state.nodes.filter((node) => node.id !== nodeId);
            const nextEdges = state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
            return {
              nodes: nextNodes,
              edges: nextEdges,
              selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
              searchResults: recomputeSearchResults(nextNodes, state.searchQuery),
              ...prunePathFocusState({
                pathFocusNodeIds: state.pathFocusNodeIds,
                pathFocusEdgeIds: state.pathFocusEdgeIds,
                pathFocusMode: state.pathFocusMode,
                validNodeIds: new Set(nextNodes.map((node) => node.id)),
                validEdgeIds: new Set(nextEdges.map((edge) => edge.id)),
              }),
            };
          });
        },

        duplicateNode: (nodeId) => {
          const node = get().nodes.find((n) => n.id === nodeId);
          if (!node) return null;

          const id = generateId();
          const now = Date.now();
          const nodeData = node.data;
          const newNode: GraphNode = {
            id,
            type: "knowledgeNode" as const,
            position: {
              x: node.position.x + 30,
              y: node.position.y + 30,
            },
            dragHandle: ".node-drag-handle",
            data: {
              ...nodeData,
              label: nodeData.label + " (副本)",
              createdAt: now,
              updatedAt: now,
            } satisfies KnowledgeNodeData,
          };
          set((state) => {
            const nextNodes = [...state.nodes, newNode];
            return {
              nodes: nextNodes,
              selectedNodeId: id,
              searchResults: recomputeSearchResults(nextNodes, state.searchQuery),
            };
          });
          return id;
        },

        setSelectedNodeId: (nodeId) => {
          set((state) => {
            const targetNodeId = nodeId && state.nodes.some((node) => node.id === nodeId) ? nodeId : null;
            const nextNodes = state.nodes.map((node) => {
              const nextSelected = targetNodeId !== null && node.id === targetNodeId;
              if (Boolean(node.selected) === nextSelected) return node;
              return {
                ...node,
                selected: nextSelected,
              };
            });
            return {
              selectedNodeId: targetNodeId,
              nodes: nextNodes,
            };
          });
        },

        setNodeEdgeColor: (nodeId, edgeColor) => {
          set({
            nodes: get().nodes.map((node) => {
              if (node.id !== nodeId) return node;
              return {
                ...node,
                data: { ...node.data, edgeColor, updatedAt: Date.now() },
              };
            }),
          });
        },

        propagateEdgeColorFromNode: (nodeId) => {
          const { nodes, edges } = get();
          const startNode = nodes.find((n) => n.id === nodeId);
          if (!startNode) return;

          // 重要度等级：越往后越低；默认视为未设置，起点会按“P0 核心”处理
          const ranks = EDGE_IMPORTANCE_RANKS;
          const startColor = normalizeEdgeColor(startNode.data.edgeColor);
          const normalizedStartColor = startColor === "default" ? ranks[0] : startColor;
          const startRankIndex = Math.max(0, ranks.indexOf(normalizedStartColor));

          const getColorByDistance = (distance: number) => {
            const idx = Math.min(startRankIndex + distance, ranks.length - 1);
            return ranks[idx];
          };

          // 构建出边邻接表（只沿 source -> target 方向传播）
          const outgoingMap = new Map<string, string[]>();
          edges.forEach((e) => {
            const list = outgoingMap.get(e.source);
            if (list) list.push(e.target);
            else outgoingMap.set(e.source, [e.target]);
          });

          // BFS：计算从起点出发的最短距离；通过 distanceMap 避免循环导致的无限遍历
          const distanceMap = new Map<string, number>();
          const queue: string[] = [];
          let head = 0;

          distanceMap.set(nodeId, 0);
          queue.push(nodeId);

          while (head < queue.length) {
            const currentId = queue[head++]!;
            const currentDistance = distanceMap.get(currentId);
            if (currentDistance === undefined) continue;
            const targets = outgoingMap.get(currentId);
            if (!targets) continue;

            targets.forEach((targetId) => {
              const nextDistance = currentDistance + 1;
              const prevDistance = distanceMap.get(targetId);
              if (prevDistance === undefined || nextDistance < prevDistance) {
                distanceMap.set(targetId, nextDistance);
                queue.push(targetId);
              }
            });
          }

          const now = Date.now();
          set({
            nodes: nodes.map((node) => {
              const distance = distanceMap.get(node.id);
              if (distance === undefined) return node;
              const edgeColor = getColorByDistance(distance);
              if (node.data.edgeColor === edgeColor) return node;
              return {
                ...node,
                data: { ...node.data, edgeColor, updatedAt: now },
              };
            }),
          });
        },

        autoLayoutFromNode: (nodeId, options) => {
          const { nodes, edges } = get();
          const lockedNodeIds = nodes.filter((node) => node.data.locked).map((node) => node.id);
          const fixedNodeIdSet = new Set<string>([...(options?.fixedNodeIds || []), ...lockedNodeIds]);
          const result = computeAutoLayoutPositions({
            nodes,
            edges,
            rootId: nodeId,
            options: {
              ...(options || {}),
              fixedNodeIds: Array.from(fixedNodeIdSet),
            },
          });
          if (result.positions.size === 0) return { ok: false, crossings: result.crossings };

          set({
            nodes: nodes.map((node) => {
              const position = result.positions.get(node.id);
              if (!position) return node;
              return { ...node, position };
            }),
          });
          return { ok: true, crossings: result.crossings };
        },

        beginDragHistoryBatch: () => {
          // 先确保追踪开启，让第一帧能记录“拖拽前”快照
          temporalApi.getState().resume();
          isHistoryPausedByDrag = false;
          shouldPauseHistoryAfterNextUpdate = true;
        },

        endDragHistoryBatch: () => {
          shouldPauseHistoryAfterNextUpdate = false;
          resumeHistoryTrackingIfPaused();
        },

        toggleNodeLock: (nodeId, lockMode, lockDepth) => {
          set({
            nodes: get().nodes.map((node) => {
              if (node.id !== nodeId) return node;
              const isCurrentlyLocked = node.data.locked;
              // 如果当前已锁定，则解除锁定；否则使用传入的 lockMode 进行锁定
              if (isCurrentlyLocked) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    locked: false,
                    lockMode: undefined,
                    lockDepth: undefined,
                    updatedAt: Date.now(),
                  },
                };
              } else {
                const nextMode = lockMode || "direct";
                const normalizedDepth = nextMode === "level"
                  ? Math.max(1, Math.floor(lockDepth ?? node.data.lockDepth ?? 2))
                  : undefined;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    locked: true,
                    lockMode: nextMode,
                    lockDepth: normalizedDepth,
                    updatedAt: Date.now(),
                  },
                };
              }
            }),
          });
        },

        getConnectedNodeIds: (nodeId, lockMode, lockDepth) => {
          const edges = get().edges;
          const outgoingMap = new Map<string, string[]>();

          edges.forEach((e) => {
            const list = outgoingMap.get(e.source);
            if (list) {
              list.push(e.target);
            } else {
              outgoingMap.set(e.source, [e.target]);
            }
          });

          // 如果是 direct 模式，只返回直接子节点
          if (lockMode === "direct") {
            return outgoingMap.get(nodeId) || [];
          }

          if (lockMode === "level") {
            const depthLimit = Math.max(1, Math.floor(lockDepth ?? 1));
            const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
            const visitedDepth = new Map<string, number>([[nodeId, 0]]);
            const result = new Set<string>();
            let head = 0;

            while (head < queue.length) {
              const current = queue[head++];
              if (!current) continue;
              if (current.depth >= depthLimit) continue;

              const targets = outgoingMap.get(current.id);
              if (!targets) continue;

              targets.forEach((targetId) => {
                const nextDepth = current.depth + 1;
                const knownDepth = visitedDepth.get(targetId);
                if (knownDepth !== undefined && knownDepth <= nextDepth) {
                  return;
                }

                visitedDepth.set(targetId, nextDepth);
                result.add(targetId);
                queue.push({ id: targetId, depth: nextDepth });
              });
            }

            return Array.from(result);
          }

          // transitive 模式：BFS 遍历所有从该节点出发可达的节点
          const visited = new Set<string>();
          const queue = [nodeId];
          let head = 0;

          while (head < queue.length) {
            const current = queue[head++]!;
            if (visited.has(current)) continue;
            visited.add(current);

            const targets = outgoingMap.get(current);
            if (!targets) continue;
            targets.forEach((targetId) => {
              if (!visited.has(targetId)) {
                queue.push(targetId);
              }
            });
          }

          // 移除起始节点自身
          visited.delete(nodeId);
          return Array.from(visited);
        },

        applyBatchEditToSelectedNodes: (payload) => {
          const { nodes, selectedNodeId } = get();
          const selectedIds = resolveSelectedNodeIds(nodes, selectedNodeId);
          if (selectedIds.length === 0) {
            return { ok: false, count: 0, message: "请先选中节点后再执行批量编辑。" };
          }

          const hasAnyAction =
            payload.color !== undefined ||
            payload.edgeColor !== undefined ||
            payload.appendTags !== undefined ||
            payload.replaceTags !== undefined ||
            payload.lock !== undefined;
          if (!hasAnyAction) {
            return { ok: false, count: selectedIds.length, message: "请至少选择一个批量编辑动作。" };
          }

          const selectedIdSet = new Set(selectedIds);
          const normalizedReplaceTags = payload.replaceTags ? normalizeTagList(payload.replaceTags) : undefined;
          const normalizedAppendTags = payload.appendTags ? normalizeTagList(payload.appendTags) : undefined;
          const now = Date.now();

          set({
            nodes: nodes.map((node) => {
              if (!selectedIdSet.has(node.id)) return node;

              const nextData: KnowledgeNodeData = {
                ...node.data,
                updatedAt: now,
              };

              if (payload.color !== undefined) {
                nextData.color = payload.color;
              }

              if (payload.edgeColor !== undefined) {
                nextData.edgeColor = payload.edgeColor;
              }

              if (normalizedReplaceTags !== undefined) {
                nextData.tags = normalizedReplaceTags;
              } else if (normalizedAppendTags !== undefined) {
                nextData.tags = normalizeTagList([...(nextData.tags || []), ...normalizedAppendTags]);
              }

              if (payload.lock !== undefined) {
                if (!payload.lock.enabled) {
                  nextData.locked = false;
                  nextData.lockMode = undefined;
                  nextData.lockDepth = undefined;
                } else {
                  const lockMode = payload.lock.mode || nextData.lockMode || "direct";
                  nextData.locked = true;
                  nextData.lockMode = lockMode;
                  nextData.lockDepth = lockMode === "level"
                    ? clampLockDepth(payload.lock.depth ?? nextData.lockDepth ?? 2)
                    : undefined;
                }
              }

              return {
                ...node,
                data: nextData,
              };
            }),
          });

          return {
            ok: true,
            count: selectedIds.length,
            message: `已批量更新 ${selectedIds.length} 个节点。`,
          };
        },

        ...createPathFocusSlice({ set, get }),

        ...createSearchSlice({ set, get }),

        ...createEdgeSlice({ set, get }),

        ...createPersistenceSlice({
          set,
          get,
          saveRequestTracker: {
            nextRequestId: () => ++latestSaveRequestId,
            isLatestRequest: (requestId) => requestId === latestSaveRequestId,
          },
        }),
      };
      },
      {
        // temporal 配置：只追踪 nodes 和 edges 的变化
        partialize: (state) => ({
          nodes: state.nodes,
          edges: state.edges,
        }),
        limit: 50, // 保留最近50个历史记录
      },
    ),
  ),
);

// 导出 temporal store 用于撤销/重做
export const useTemporalStore = useGraphStore.temporal;
