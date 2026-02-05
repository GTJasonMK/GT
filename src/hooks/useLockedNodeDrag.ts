import { useCallback, useRef } from "react";
import type { Node, OnNodeDrag, OnNodesChange } from "@xyflow/react";
import type { KnowledgeNodeData, LockMode } from "@/types";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;

interface UseLockedNodeDragArgs {
  nodes: GraphNode[];
  onNodesChange: OnNodesChange<GraphNode>;
  getConnectedNodeIds: (nodeId: string, lockMode?: LockMode) => string[];
}

interface DragOffset {
  id: string;
  dx: number;
  dy: number;
}

/**
 * 锁定拖拽：拖动“锁定节点”时，同步移动其所有可达子节点（BFS）。
 * 说明：
 * - 该逻辑原先散落在 GraphCanvas 中，抽出后可复用且更易测试/维护。
 */
export function useLockedNodeDrag({ nodes, onNodesChange, getConnectedNodeIds }: UseLockedNodeDragArgs) {
  // 拖拽锁定节点时记录子节点的相对位置（相对“被拖拽节点”的偏移）
  const dragOffsetsRef = useRef<DragOffset[] | null>(null);
  const lastDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const flushPositionUpdates = useCallback(() => {
    rafIdRef.current = null;
    const offsets = dragOffsetsRef.current;
    const lastPosition = lastDragPositionRef.current;
    if (!offsets || !lastPosition) return;

    onNodesChange(
      offsets.map(({ id, dx, dy }) => ({
        type: "position" as const,
        id,
        position: {
          x: lastPosition.x + dx,
          y: lastPosition.y + dy,
        },
      })),
    );
  }, [onNodesChange]);

  const schedulePositionUpdates = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(flushPositionUpdates);
  }, [flushPositionUpdates]);

  const onNodeDragStart: OnNodeDrag<GraphNode> = useCallback(
    (_, node) => {
      if (!node.data.locked) {
        dragOffsetsRef.current = null;
        lastDragPositionRef.current = null;
        return;
      }

      // 使用节点的 lockMode，默认为 direct
      const lockMode = node.data.lockMode || "direct";
      const connectedIds = getConnectedNodeIds(node.id, lockMode);
      if (connectedIds.length === 0) {
        dragOffsetsRef.current = null;
        lastDragPositionRef.current = null;
        return;
      }

      // 取消可能残留的 RAF（例如极端情况下多次触发 start）
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const connectedSet = new Set(connectedIds);
      const offsets: DragOffset[] = [];
      nodes.forEach((n) => {
        if (!connectedSet.has(n.id)) return;
        offsets.push({
          id: n.id,
          dx: n.position.x - node.position.x,
          dy: n.position.y - node.position.y,
        });
      });

      dragOffsetsRef.current = offsets;
      lastDragPositionRef.current = { x: node.position.x, y: node.position.y };
    },
    [getConnectedNodeIds, nodes],
  );

  const onNodeDrag: OnNodeDrag<GraphNode> = useCallback(
    (_, node) => {
      if (!dragOffsetsRef.current) return;

      // 只记录最新位置，实际更新合并到 RAF，避免在高频事件中做 O(k) 的计算与 setState
      lastDragPositionRef.current = { x: node.position.x, y: node.position.y };
      schedulePositionUpdates();
    },
    [schedulePositionUpdates],
  );

  const onNodeDragStop: OnNodeDrag<GraphNode> = useCallback(() => {
    // 停止时补齐一次最终位置，并清理 RAF
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      flushPositionUpdates();
    }

    dragOffsetsRef.current = null;
    lastDragPositionRef.current = null;
  }, [flushPositionUpdates]);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
