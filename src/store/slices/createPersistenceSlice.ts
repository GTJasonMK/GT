import type { StoreApi } from "zustand";
import type { GraphEdge, GraphNode, GraphStore } from "@/store/graphStore";
import type { KnowledgeNodeData } from "@/types";
import { loadGraphData, saveGraphData } from "@/services/graphStorage";
import { clampLockDepth, normalizeEdgeColor, normalizeEdgeData, normalizeNodeColor, normalizeTagList } from "@/lib/graphDataUtils";

interface SaveRequestTracker {
  nextRequestId: () => number;
  isLatestRequest: (requestId: number) => boolean;
}

interface CreatePersistenceSliceArgs {
  set: StoreApi<GraphStore>["setState"];
  get: StoreApi<GraphStore>["getState"];
  saveRequestTracker: SaveRequestTracker;
}

export function createPersistenceSlice(args: CreatePersistenceSliceArgs): Pick<
  GraphStore,
  | "markSaveStatusIdle"
  | "saveData"
  | "loadData"
  | "exportData"
  | "exportSelectedNodesData"
  | "exportSelectedSubgraphData"
  | "importData"
> {
  const { set, get, saveRequestTracker } = args;

  return {
    markSaveStatusIdle: () => {
      set((state) => {
        if (state.saveStatus === "idle") return state;
        return { saveStatus: "idle" };
      });
    },

    saveData: async () => {
      const snapshotNodes = get().nodes;
      const snapshotEdges = get().edges;
      const snapshotData = get().exportData();
      const requestId = saveRequestTracker.nextRequestId();

      set({ saveStatus: "saving" });
      try {
        await saveGraphData(snapshotData);

        if (!saveRequestTracker.isLatestRequest(requestId)) return;

        const { nodes, edges } = get();
        const hasNewChanges = nodes !== snapshotNodes || edges !== snapshotEdges;
        set({ saveStatus: hasNewChanges ? "idle" : "saved" });
      } catch (e) {
        console.error("保存失败:", e);
        if (!saveRequestTracker.isLatestRequest(requestId)) return;
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
          type: "knowledgeNode" as const,
          position: n.position,
          data: n.data,
        })),
        edges: edges.map((e) => {
          const edgeData = normalizeEdgeData(e.data);
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            label: typeof e.label === "string" ? e.label : edgeData?.label,
            data: edgeData,
          };
        }),
      };
    },

    exportSelectedNodesData: () => {
      const { nodes, edges, selectedNodeId } = get();
      let selectedNodes = nodes.filter((node) => Boolean(node.selected));

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
          type: "knowledgeNode" as const,
          position: node.position,
          data: node.data,
        })),
        edges: selectedEdges.map((edge) => {
          const edgeData = normalizeEdgeData(edge.data);
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: typeof edge.label === "string" ? edge.label : edgeData?.label,
            data: edgeData,
          };
        }),
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
          type: "knowledgeNode" as const,
          position: node.position,
          data: node.data,
        })),
        edges: selectedEdges.map((edge) => {
          const edgeData = normalizeEdgeData(edge.data);
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: typeof edge.label === "string" ? edge.label : edgeData?.label,
            data: edgeData,
          };
        }),
      };
    },

    importData: (data) => {
      const now = Date.now();
      const seenNodeIds = new Set<string>();
      const normalizedNodes: GraphNode[] = [];

      data.nodes.forEach((node, index) => {
        if (!node || typeof node.id !== "string" || node.id.length === 0) return;
        if (seenNodeIds.has(node.id)) {
          console.warn("[导入警告] 检测到重复节点ID，已忽略后续重复项:", node.id);
          return;
        }
        seenNodeIds.add(node.id);

        const rawData = typeof node.data === "object" && node.data ? (node.data as Partial<KnowledgeNodeData>) : {};
        const lockMode = rawData.lockMode === "direct" || rawData.lockMode === "level" || rawData.lockMode === "transitive"
          ? rawData.lockMode
          : undefined;
        const isLocked = Boolean(rawData.locked) && Boolean(lockMode);
        const tags = Array.isArray(rawData.tags)
          ? normalizeTagList(rawData.tags.filter((tag): tag is string => typeof tag === "string"))
          : [];

        normalizedNodes.push({
          id: node.id,
          type: "knowledgeNode",
          position: {
            x: typeof node.position?.x === "number" && Number.isFinite(node.position.x) ? node.position.x : index * 24,
            y: typeof node.position?.y === "number" && Number.isFinite(node.position.y) ? node.position.y : index * 24,
          },
          dragHandle: ".node-drag-handle",
          data: {
            label: typeof rawData.label === "string" && rawData.label.trim() ? rawData.label : "未命名",
            content: typeof rawData.content === "string" ? rawData.content : "",
            tags,
            color: normalizeNodeColor(rawData.color),
            edgeColor: normalizeEdgeColor(rawData.edgeColor),
            locked: isLocked ? true : undefined,
            lockMode: isLocked ? lockMode : undefined,
            lockDepth: isLocked && lockMode === "level"
              ? clampLockDepth(typeof rawData.lockDepth === "number" ? rawData.lockDepth : 2)
              : undefined,
            createdAt: typeof rawData.createdAt === "number" ? rawData.createdAt : now,
            updatedAt: typeof rawData.updatedAt === "number" ? rawData.updatedAt : now,
          } satisfies KnowledgeNodeData,
        });
      });

      const validNodeIdSet = new Set(normalizedNodes.map((node) => node.id));
      const seenEdgeIds = new Set<string>();
      const normalizedEdges: GraphEdge[] = [];

      data.edges.forEach((edge) => {
        if (!edge || typeof edge.id !== "string" || edge.id.length === 0 || typeof edge.source !== "string" || typeof edge.target !== "string") {
          return;
        }
        if (!validNodeIdSet.has(edge.source) || !validNodeIdSet.has(edge.target)) {
          return;
        }

        let edgeId = edge.id;
        if (seenEdgeIds.has(edgeId)) {
          let suffix = 1;
          while (seenEdgeIds.has(`${edgeId}__${suffix}`)) {
            suffix += 1;
          }
          const newEdgeId = `${edgeId}__${suffix}`;
          console.warn("[导入警告] 检测到重复边ID，已自动重命名:", edgeId, "->", newEdgeId);
          edgeId = newEdgeId;
        }
        seenEdgeIds.add(edgeId);

        const edgeData = normalizeEdgeData(edge.data);
        const edgeLabel = typeof edge.label === "string" ? edge.label : edgeData?.label;

        normalizedEdges.push({
          id: edgeId,
          source: edge.source,
          target: edge.target,
          type: "centerEdge",
          label: edgeLabel,
          data: edgeData as Record<string, unknown> | undefined,
        });
      });

      set({
        nodes: normalizedNodes,
        edges: normalizedEdges,
        selectedNodeId: null,
        pathFocusNodeIds: [],
        pathFocusEdgeIds: [],
        pathFocusMode: null,
        searchQuery: "",
        searchResults: [],
      });
    },
  };
}
