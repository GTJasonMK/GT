import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { FOCUS_NODE_DURATION_MS, FOCUS_NODE_ZOOM, NODE_CENTER_OFFSET } from "@/constants/graphLayout";

type NodeLike = { position: { x: number; y: number } };

/**
 * 统一的“定位到节点”行为
 * - 统一中心偏移与动画参数，避免各处散落魔法数字
 */
export function useFocusNode() {
  const { setCenter } = useReactFlow();

  return useCallback(
    (node: NodeLike) => {
      setCenter(
        node.position.x + NODE_CENTER_OFFSET.x,
        node.position.y + NODE_CENTER_OFFSET.y,
        { zoom: FOCUS_NODE_ZOOM, duration: FOCUS_NODE_DURATION_MS },
      );
    },
    [setCenter],
  );
}

