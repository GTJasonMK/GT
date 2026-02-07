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
import { EDGE_COLORS, EDGE_IMPORTANCE_RANKS, type KnowledgeNodeData, type GraphData, type EdgeColor, type LockMode, type NodeColor } from "@/types";
import { loadGraphData, saveGraphData } from "@/services/graphStorage";
import { type AutoLayoutOptions, computeAutoLayoutPositions } from "@/lib/graphAutoLayout";

// 生成唯一 ID
const generateId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;
type GraphEdge = Edge;

const EDGE_COLOR_MIGRATION_MAP: Record<string, EdgeColor> = {
  core: "p0",
  important: "p3",
  normal: "p5",
  minor: "p6",
};

function normalizeEdgeColor(value: unknown): EdgeColor {
  if (typeof value !== "string") return "default";
  if (Object.prototype.hasOwnProperty.call(EDGE_COLORS, value)) return value as EdgeColor;
  return EDGE_COLOR_MIGRATION_MAP[value] ?? "default";
}

function resolveSelectedNodeIds(nodes: GraphNode[], selectedNodeId: string | null): string[] {
  const multiSelectedIds = nodes.filter((node) => Boolean(node.selected)).map((node) => node.id);
  if (multiSelectedIds.length > 0) return multiSelectedIds;
  if (!selectedNodeId) return [];
  return nodes.some((node) => node.id === selectedNodeId) ? [selectedNodeId] : [];
}

function normalizeTagList(tags: string[]): string[] {
  const nextTags = tags.map((tag) => tag.trim()).filter(Boolean);
  return Array.from(new Set(nextTags));
}

function clampLockDepth(depth: number): number {
  return Math.max(1, Math.floor(depth));
}

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

interface GraphStore {
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
          set({ nodes: applyNodeChanges(changes, get().nodes) });
          pauseHistoryTrackingIfRequested();
        },

        onEdgesChange: (changes) => {
          set({ edges: applyEdgeChanges(changes, get().edges) });
          pauseHistoryTrackingIfRequested();
        },

        onConnect: (connection) => {
          set({ edges: addEdge({ ...connection, type: "centerEdge" }, get().edges) });
        },

        addNode: (position, label) => {
          const id = generateId();
          const now = Date.now();
          const newNode: GraphNode = {
            id,
            type: "knowledgeNode",
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
          set({ nodes: [...get().nodes, newNode] });
          return id;
        },

        updateNodeData: (nodeId, data) => {
          set({
            nodes: get().nodes.map((node) => {
              if (node.id !== nodeId) return node;
              return {
                ...node,
                data: { ...node.data, ...data, updatedAt: Date.now() },
              };
            }),
          });
        },

        deleteNode: (nodeId) => {
          set({
            nodes: get().nodes.filter((n) => n.id !== nodeId),
            edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
            selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
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
            type: "knowledgeNode",
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
          set({ nodes: [...get().nodes, newNode], selectedNodeId: id });
          return id;
        },

        setSelectedNodeId: (nodeId) => {
          set({ selectedNodeId: nodeId });
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

        focusShortestPathBetweenSelectedNodes: () => {
          const { nodes, edges, selectedNodeId } = get();
          let selectedNodes = nodes.filter((node) => Boolean(node.selected));

          // 兼容：若没有多选状态，保留单选结果用于提示
          if (selectedNodes.length === 0 && selectedNodeId) {
            const single = nodes.find((node) => node.id === selectedNodeId);
            if (single) selectedNodes = [single];
          }

          if (selectedNodes.length !== 2) {
            return { ok: false, message: "请先框选两个节点，再执行一键聚焦路径。" };
          }

          const startId = selectedNodes[0]!.id;
          const targetId = selectedNodes[1]!.id;

          const buildAdjacency = (directed: boolean) => {
            const map = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
            nodes.forEach((node) => map.set(node.id, []));

            edges.forEach((edge) => {
              map.get(edge.source)?.push({ nodeId: edge.target, edgeId: edge.id });
              if (!directed) {
                map.get(edge.target)?.push({ nodeId: edge.source, edgeId: edge.id });
              }
            });

            return map;
          };

          const findPath = (directed: boolean) => {
            const adjacency = buildAdjacency(directed);
            const queue = [startId];
            const visited = new Set<string>([startId]);
            const prev = new Map<string, { nodeId: string; edgeId: string }>();
            let head = 0;

            while (head < queue.length) {
              const current = queue[head++]!;
              if (current === targetId) break;

              const nextList = adjacency.get(current) || [];
              nextList.forEach((next) => {
                if (visited.has(next.nodeId)) return;
                visited.add(next.nodeId);
                prev.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
                queue.push(next.nodeId);
              });
            }

            if (!visited.has(targetId)) return null;

            const pathNodeIds: string[] = [targetId];
            const pathEdgeIds: string[] = [];
            let cursor = targetId;

            while (cursor !== startId) {
              const p = prev.get(cursor);
              if (!p) break;
              pathEdgeIds.push(p.edgeId);
              pathNodeIds.push(p.nodeId);
              cursor = p.nodeId;
            }

            pathNodeIds.reverse();
            pathEdgeIds.reverse();
            return { pathNodeIds, pathEdgeIds };
          };

          let mode: "directed" | "undirected" = "directed";
          let path = findPath(true);
          if (!path) {
            mode = "undirected";
            path = findPath(false);
          }

          if (!path || path.pathEdgeIds.length === 0) {
            return { ok: false, message: "未找到可用路径：请检查节点是否连通。" };
          }

          set({
            pathFocusNodeIds: path.pathNodeIds,
            pathFocusEdgeIds: path.pathEdgeIds,
            pathFocusMode: mode,
          });

          return {
            ok: true,
            message: mode === "directed"
              ? `已聚焦最短路径（有向），共 ${path.pathEdgeIds.length} 条连线。`
              : `已聚焦最短路径（无向近邻），共 ${path.pathEdgeIds.length} 条连线。`,
          };
        },

        clearPathFocus: () => {
          set({ pathFocusNodeIds: [], pathFocusEdgeIds: [], pathFocusMode: null });
        },

        setSearchQuery: (query) => {
          const q = query.toLowerCase().trim();
          if (!q) {
            set({ searchQuery: "", searchResults: [] });
            return;
          }
          const results = get().nodes
            .filter((node) => {
              const labelMatch = node.data.label?.toLowerCase().includes(q);
              const tagMatch = node.data.tags?.some((tag) => tag.toLowerCase().includes(q));
              const contentMatch = node.data.content?.toLowerCase().includes(q);
              return labelMatch || tagMatch || contentMatch;
            })
            .map((n) => n.id);
          set({ searchQuery: query, searchResults: results });
        },

        updateEdgeLabel: (edgeId, label) => {
          set({
            edges: get().edges.map((edge) => {
              if (edge.id !== edgeId) return edge;
              return { ...edge, label };
            }),
          });
        },

        saveData: async () => {
          set({ saveStatus: "saving" });
          try {
            await saveGraphData(get().exportData());
            set({ saveStatus: "saved" });
          } catch (e) {
            console.error("保存失败:", e);
            set({ saveStatus: "idle" });
          }
        },

        loadData: async () => {
          try {
            const data = await loadGraphData();
            if (data) get().importData(data);
          } catch (e) {
            console.error("加载数据失败:", e);
          }
        },

        exportData: () => {
          const { nodes, edges } = get();
          return {
            nodes: nodes.map((n) => ({
              id: n.id,
              type: "knowledgeNode",
              position: n.position,
              data: n.data,
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              label: typeof e.label === "string" ? e.label : undefined,
            })),
          };
        },

        exportSelectedNodesData: () => {
          const { nodes, edges, selectedNodeId } = get();
          let selectedNodes = nodes.filter((node) => Boolean(node.selected));

          // 兜底：若当前没有多选状态，但存在“当前选中节点”则按单节点导出
          if (selectedNodes.length === 0 && selectedNodeId) {
            const node = nodes.find((item) => item.id === selectedNodeId);
            if (node) selectedNodes = [node];
          }

          if (selectedNodes.length === 0) return null;

          const selectedNodeIdSet = new Set(selectedNodes.map((node) => node.id));
          const selectedEdges = edges.filter((edge) => selectedNodeIdSet.has(edge.source) && selectedNodeIdSet.has(edge.target));

          return {
            nodes: selectedNodes.map((node) => ({
              id: node.id,
              type: "knowledgeNode",
              position: node.position,
              data: node.data,
            })),
            edges: selectedEdges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: typeof edge.label === "string" ? edge.label : undefined,
            })),
          };
        },

        exportSelectedSubgraphData: () => {
          const { nodes, edges, selectedNodeId } = get();
          if (!selectedNodeId) return null;

          const outgoingMap = new Map<string, string[]>();
          const incomingMap = new Map<string, string[]>();
          edges.forEach((edge) => {
            const out = outgoingMap.get(edge.source);
            if (out) out.push(edge.target);
            else outgoingMap.set(edge.source, [edge.target]);

            const incoming = incomingMap.get(edge.target);
            if (incoming) incoming.push(edge.source);
            else incomingMap.set(edge.target, [edge.source]);
          });

          const visited = new Set<string>();
          const queue = [selectedNodeId];
          let head = 0;
          visited.add(selectedNodeId);

          while (head < queue.length) {
            const current = queue[head++]!;
            const nextIds = [...(outgoingMap.get(current) || []), ...(incomingMap.get(current) || [])];
            nextIds.forEach((id) => {
              if (visited.has(id)) return;
              visited.add(id);
              queue.push(id);
            });
          }

          const selectedNodeSet = visited;
          const selectedNodes = nodes.filter((node) => selectedNodeSet.has(node.id));
          const selectedEdges = edges.filter((edge) => selectedNodeSet.has(edge.source) && selectedNodeSet.has(edge.target));
          if (selectedNodes.length === 0) return null;

          return {
            nodes: selectedNodes.map((node) => ({
              id: node.id,
              type: "knowledgeNode",
              position: node.position,
              data: node.data,
            })),
            edges: selectedEdges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: typeof edge.label === "string" ? edge.label : undefined,
            })),
          };
        },

        importData: (data) => {
          set({
            nodes: data.nodes.map((n) => ({
              id: n.id,
              type: "knowledgeNode",
              position: n.position,
              dragHandle: ".node-drag-handle",
              data: { ...n.data, edgeColor: normalizeEdgeColor(n.data.edgeColor) },
            })),
            edges: data.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              type: "centerEdge",
              label: e.label,
            })),
            selectedNodeId: null,
            pathFocusNodeIds: [],
            pathFocusEdgeIds: [],
            pathFocusMode: null,
          });
        },
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
