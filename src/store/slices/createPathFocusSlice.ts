import type { StoreApi } from "zustand";
import type { GraphStore } from "@/store/graphStore";

interface CreatePathFocusSliceArgs {
  set: StoreApi<GraphStore>["setState"];
  get: StoreApi<GraphStore>["getState"];
}

export function createPathFocusSlice({ set, get }: CreatePathFocusSliceArgs): Pick<GraphStore, "focusShortestPathBetweenSelectedNodes" | "clearPathFocus"> {
  return {
    focusShortestPathBetweenSelectedNodes: () => {
      const { nodes, edges, selectedNodeId } = get();
      let selectedNodes = nodes.filter((node) => Boolean(node.selected));

      if (selectedNodes.length === 0 && selectedNodeId) {
        const single = nodes.find((node) => node.id === selectedNodeId);
        if (single) selectedNodes = [single];
      }

      if (selectedNodes.length !== 2) {
        return { ok: false, message: "请先框选两个节点，再执行一键聚焦路径。" };
      }

      const firstSelectedId = selectedNodes[0]!.id;
      const secondSelectedId = selectedNodes[1]!.id;

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

      const findPath = (directed: boolean, fromId: string, toId: string) => {
        const adjacency = buildAdjacency(directed);
        const queue = [fromId];
        const visited = new Set<string>([fromId]);
        const prev = new Map<string, { nodeId: string; edgeId: string }>();
        let head = 0;

        while (head < queue.length) {
          const current = queue[head++]!;
          if (current === toId) break;

          const nextList = adjacency.get(current) || [];
          nextList.forEach((next) => {
            if (visited.has(next.nodeId)) return;
            visited.add(next.nodeId);
            prev.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
            queue.push(next.nodeId);
          });
        }

        if (!visited.has(toId)) return null;

        const pathNodeIds: string[] = [toId];
        const pathEdgeIds: string[] = [];
        let cursor = toId;

        while (cursor !== fromId) {
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

      const directedForwardPath = findPath(true, firstSelectedId, secondSelectedId);
      const directedBackwardPath = findPath(true, secondSelectedId, firstSelectedId);

      let mode: "directed" | "undirected" = "directed";
      let path = directedForwardPath ?? directedBackwardPath;

      if (directedForwardPath && directedBackwardPath) {
        path = directedForwardPath.pathEdgeIds.length <= directedBackwardPath.pathEdgeIds.length
          ? directedForwardPath
          : directedBackwardPath;
      }

      if (!path) {
        mode = "undirected";
        path = findPath(false, firstSelectedId, secondSelectedId);
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
  };
}
