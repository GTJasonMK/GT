import { Suspense, lazy, useCallback, useMemo, useState, type FC } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStoreWithEqualityFn } from "zustand/traditional";

import KnowledgeNode from "./KnowledgeNode";
import CenterEdge from "./CenterEdge";
import { useGraphStore } from "@/store/graphStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { useCanvasInteraction } from "@/hooks/useCanvasInteraction";
import { useLockedNodeDrag } from "@/hooks/useLockedNodeDrag";
import type { EdgeColor, KnowledgeNodeData } from "@/types";
import { NODE_COLORS, EDGE_COLORS } from "@/types";
import { NODE_CENTER_OFFSET } from "@/constants/graphLayout";
import { buildGraphContextMenuItems, type GraphContextMenuState } from "./graphCanvas/contextMenuItems";
import { CANVAS_ELEMENT_ID } from "@/constants/dom";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;
type GraphEdge = Edge;

function areNodesEqualByIdAndEdgeColor(prev: GraphNode[], next: GraphNode[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.id !== next[i]?.id) return false;
    if (prev[i]?.data.edgeColor !== next[i]?.data.edgeColor) return false;
  }
  return true;
}

// 注册自定义节点类型
const nodeTypes = {
  knowledgeNode: KnowledgeNode,
};

// 注册自定义边类型
const edgeTypes = {
  centerEdge: CenterEdge,
};

const preloadContextMenu = () => import("./ContextMenu");
const ContextMenu = lazy(preloadContextMenu);

/**
 * 图画布组件
 * 用于展示和操作知识节点图
 */
const GraphCanvas: FC = () => {
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { theme } = useTheme();
  const { shouldShowContextMenu } = useCanvasInteraction();

  const nodes = useGraphStore((s) => s.nodes);
  const nodesForEdgeColors = useStoreWithEqualityFn(useGraphStore, (s) => s.nodes, areNodesEqualByIdAndEdgeColor);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const addNode = useGraphStore((s) => s.addNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const beginDragHistoryBatch = useGraphStore((s) => s.beginDragHistoryBatch);
  const endDragHistoryBatch = useGraphStore((s) => s.endDragHistoryBatch);
  const getConnectedNodeIds = useGraphStore((s) => s.getConnectedNodeIds);
  const updateEdgeLabel = useGraphStore((s) => s.updateEdgeLabel);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const pathFocusEdgeIds = useGraphStore((s) => s.pathFocusEdgeIds);
  const pathFocusMode = useGraphStore((s) => s.pathFocusMode);
  const globalEdgeFlowAnimation = useSettingsStore((s) => s.layout.globalEdgeFlowAnimation);
  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useLockedNodeDrag({
    nodes,
    onNodesChange,
    getConnectedNodeIds,
  });

  const pathFocusEdgeIdSet = useMemo(() => new Set(pathFocusEdgeIds), [pathFocusEdgeIds]);
  const hasPathFocus = useMemo(() => {
    if (pathFocusEdgeIdSet.size === 0) return false;
    return edges.some((edge) => pathFocusEdgeIdSet.has(edge.id));
  }, [edges, pathFocusEdgeIdSet]);

  const edgeColorByNodeId = useMemo(() => {
    const map = new Map<string, EdgeColor>();
    nodesForEdgeColors.forEach((n) => {
      map.set(n.id, n.data.edgeColor || "default");
    });
    return map;
  }, [nodesForEdgeColors]);

  // 根据源节点的 edgeColor 计算带颜色的边
  const edgesWithColors = useMemo(() => {
    return edges.map((edge) => {
      const rawEdgeColor = edgeColorByNodeId.get(edge.source);
      const edgeColor: EdgeColor =
        rawEdgeColor && Object.prototype.hasOwnProperty.call(EDGE_COLORS, rawEdgeColor)
          ? rawEdgeColor
          : "default";
      const colorConfig = EDGE_COLORS[edgeColor];
      const isOutgoingFromSelected = Boolean(selectedNodeId && edge.source === selectedNodeId);
      const isIncomingToSelected = Boolean(selectedNodeId && edge.target === selectedNodeId);
      const focusType = isOutgoingFromSelected ? "outgoing" : isIncomingToSelected ? "incoming" : undefined;
      const isPathFocused = hasPathFocus && pathFocusEdgeIdSet.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: colorConfig.stroke,
        },
        data: {
          ...edge.data,
          edgeColor,
          focusFlow: Boolean(focusType),
          focusType,
          globalFlowAnimation: globalEdgeFlowAnimation,
          pathFocusActive: hasPathFocus,
          pathFocused: isPathFocused,
          pathFocusMode,
        },
      };
    });
  }, [
    edges,
    edgeColorByNodeId,
    selectedNodeId,
    globalEdgeFlowAnimation,
    hasPathFocus,
    pathFocusEdgeIdSet,
    pathFocusMode,
  ]);

  // 双击画布空白处添加新节点
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode({ x: position.x - NODE_CENTER_OFFSET.x, y: position.y - NODE_CENTER_OFFSET.y });
    },
    [addNode, screenToFlowPosition],
  );

  // 点击节点选中
  const handleNodeClick: NodeMouseHandler<GraphNode> = useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handleNodeDragStart: OnNodeDrag<GraphNode> = useCallback(
    (event, node, allNodes) => {
      setIsDragging(true);
      beginDragHistoryBatch();
      onNodeDragStart(event, node, allNodes);
    },
    [beginDragHistoryBatch, onNodeDragStart],
  );

  const handleNodeDrag: OnNodeDrag<GraphNode> = onNodeDrag;

  const handleNodeDragStop: OnNodeDrag<GraphNode> = useCallback(
    (event, node, allNodes) => {
      setIsDragging(false);
      endDragHistoryBatch();
      onNodeDragStop(event, node, allNodes);
    },
    [endDragHistoryBatch, onNodeDragStop],
  );

  // 点击画布空白处取消选中并关闭菜单
  const handlePaneClickSingle = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, [setSelectedNodeId]);

  // 画布右键菜单
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      preloadContextMenu();
      if (!shouldShowContextMenu()) return;
      setContextMenu({
        x: (event as React.MouseEvent).clientX ?? (event as MouseEvent).clientX,
        y: (event as React.MouseEvent).clientY ?? (event as MouseEvent).clientY,
        type: "pane",
      });
    },
    [shouldShowContextMenu],
  );

  // 节点右键菜单
  const handleNodeContextMenu: NodeMouseHandler<GraphNode> = useCallback(
    (event, node) => {
      event.preventDefault();
      preloadContextMenu();
      if (!shouldShowContextMenu()) return;
      setSelectedNodeId(node.id);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: "node",
        targetId: node.id,
      });
    },
    [setSelectedNodeId, shouldShowContextMenu],
  );

  // 边右键菜单
  const handleEdgeContextMenu: EdgeMouseHandler<GraphEdge> = useCallback(
    (event, edge) => {
      event.preventDefault();
      preloadContextMenu();
      if (!shouldShowContextMenu()) return;
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: "edge",
        targetId: edge.id,
      });
    },
    [shouldShowContextMenu],
  );

  // 关闭上下文菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const addNodeFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY });
      addNode({ x: position.x - NODE_CENTER_OFFSET.x, y: position.y - NODE_CENTER_OFFSET.y });
    },
    [addNode, screenToFlowPosition],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      onEdgesChange([{ type: "remove", id: edgeId }]);
    },
    [onEdgesChange],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    return buildGraphContextMenuItems({
      menu: contextMenu,
      addNodeFromClientPoint,
      setSelectedNodeId,
      duplicateNode,
      deleteNode,
      updateEdgeLabel,
      deleteEdge,
    });
  }, [
    contextMenu,
    addNodeFromClientPoint,
    setSelectedNodeId,
    duplicateNode,
    deleteNode,
    updateEdgeLabel,
    deleteEdge,
  ]);

  // MiniMap 节点颜色
  const nodeColor = useCallback((node: GraphNode) => {
    const colorConfig = NODE_COLORS[node.data.color || "default"];
    return colorConfig.border;
  }, []);

  return (
    <>
      <ReactFlow<GraphNode, GraphEdge>
        id={CANVAS_ELEMENT_ID}
        nodes={nodes}
        edges={edgesWithColors}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClickSingle}
        onPaneContextMenu={handlePaneContextMenu}
        onDoubleClick={handlePaneDoubleClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        panOnDrag={[1]}
        selectionOnDrag
        panOnScroll
        minZoom={0.05}
        onlyRenderVisibleElements
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panActivationKeyCode={null}
        selectionKeyCode={null}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: "centerEdge" }}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas"
      >
        <Controls className="!shadow-md !rounded-xl !border !border-border" style={{ backgroundColor: theme === "dark" ? "#231F1B" : "#FDFBF8" }} />

        {/* MiniMap 显示/隐藏切换按钮 */}
        <button
          onClick={() => setShowMiniMap(!showMiniMap)}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-border rounded-lg shadow-sm hover:bg-surface hover:border-primary-light transition-all duration-200 cursor-pointer text-text-muted"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {showMiniMap
              ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
              : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><line x1="1" y1="1" x2="23" y2="23" /></>
            }
          </svg>
          {showMiniMap ? "隐藏地图" : "显示地图"}
        </button>

        {showMiniMap && !isDragging && (
          <MiniMap
            nodeColor={nodeColor}
            maskColor={theme === "dark" ? "rgba(245, 158, 11, 0.08)" : "rgba(180, 83, 9, 0.08)"}
            bgColor={theme === "dark" ? "#231F1B" : "#FDFBF8"}
            className="!shadow-md !rounded-xl !border !border-border"
          />
        )}
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={theme === "dark" ? "#3D3630" : "#DDD5CB"} />
      </ReactFlow>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <Suspense fallback={null}>
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={closeContextMenu}
          />
        </Suspense>
      )}
    </>
  );
};

export default GraphCanvas;
