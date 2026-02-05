import type { Node } from "@xyflow/react";
import type { ContextMenuItem } from "../ContextMenu";
import type { EdgeColor, KnowledgeNodeData, LockMode } from "@/types";
import { EDGE_COLORS, EDGE_IMPORTANCE_RANKS } from "@/types";

export interface GraphContextMenuState {
  x: number;
  y: number;
  type: "pane" | "node" | "edge";
  targetId?: string;
}

interface BuildGraphContextMenuItemsArgs {
  menu: GraphContextMenuState;
  nodes: Array<Node<KnowledgeNodeData, "knowledgeNode">>;

  addNodeFromClientPoint: (clientX: number, clientY: number) => void;

  setSelectedNodeId: (nodeId: string | null) => void;
  duplicateNode: (nodeId: string) => void;
  toggleNodeLock: (nodeId: string, lockMode?: LockMode) => void;
  setNodeEdgeColor: (nodeId: string, edgeColor: EdgeColor) => void;
  propagateEdgeColorFromNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;

  updateEdgeLabel: (edgeId: string, label: string) => void;
  deleteEdge: (edgeId: string) => void;
}

const EDGE_LABEL_OPTIONS = ["相关", "前置", "扩展", "包含"];

function getHigherEdgeColor(current: EdgeColor): EdgeColor {
  if (current === "default") return EDGE_IMPORTANCE_RANKS[0];
  const currentIndex = EDGE_IMPORTANCE_RANKS.indexOf(current);
  if (currentIndex <= 0) return EDGE_IMPORTANCE_RANKS[0];
  return EDGE_IMPORTANCE_RANKS[currentIndex - 1];
}

function getLowerEdgeColor(current: EdgeColor): EdgeColor {
  if (current === "default") return EDGE_IMPORTANCE_RANKS[EDGE_IMPORTANCE_RANKS.length - 1];
  const currentIndex = EDGE_IMPORTANCE_RANKS.indexOf(current);
  if (currentIndex < 0) return EDGE_IMPORTANCE_RANKS[EDGE_IMPORTANCE_RANKS.length - 1];
  if (currentIndex >= EDGE_IMPORTANCE_RANKS.length - 1) return EDGE_IMPORTANCE_RANKS[EDGE_IMPORTANCE_RANKS.length - 1];
  return EDGE_IMPORTANCE_RANKS[currentIndex + 1];
}

export function buildGraphContextMenuItems(args: BuildGraphContextMenuItemsArgs): ContextMenuItem[] {
  const {
    menu,
    nodes,
    addNodeFromClientPoint,
    setSelectedNodeId,
    duplicateNode,
    toggleNodeLock,
    setNodeEdgeColor,
    propagateEdgeColorFromNode,
    deleteNode,
    updateEdgeLabel,
    deleteEdge,
  } = args;

  if (menu.type === "pane") {
    return [
      {
        label: "添加节点",
        onClick: () => addNodeFromClientPoint(menu.x, menu.y),
      },
    ];
  }

  if (menu.type === "node" && menu.targetId) {
    const nodeId = menu.targetId;
    const node = nodes.find((n) => n.id === nodeId);
    const nodeData = node?.data;
    const rawEdgeColor = nodeData?.edgeColor;
    const currentEdgeColor =
      rawEdgeColor && Object.prototype.hasOwnProperty.call(EDGE_COLORS, rawEdgeColor)
        ? rawEdgeColor
        : "default";
    const isLocked = nodeData?.locked || false;
    const lockMode = nodeData?.lockMode || "direct";

    // 锁定相关菜单项
    const lockMenuItems: ContextMenuItem[] = isLocked
      ? [
          {
            label: `解除锁定 (${lockMode === "direct" ? "直接" : "传递"})`,
            onClick: () => toggleNodeLock(nodeId),
          },
        ]
      : [
          {
            label: "锁定直接子节点",
            onClick: () => toggleNodeLock(nodeId, "direct"),
          },
          {
            label: "锁定所有子节点",
            onClick: () => toggleNodeLock(nodeId, "transitive"),
          },
        ];

    return [
      {
        label: "编辑节点",
        onClick: () => setSelectedNodeId(nodeId),
      },
      {
        label: "复制节点",
        onClick: () => duplicateNode(nodeId),
      },
      ...lockMenuItems,
      { label: "", onClick: () => {}, divider: true },
      {
        label: `重要度：提高一级（当前 ${EDGE_COLORS[currentEdgeColor].label}）`,
        onClick: () => setNodeEdgeColor(nodeId, getHigherEdgeColor(currentEdgeColor)),
      },
      {
        label: `重要度：降低一级（当前 ${EDGE_COLORS[currentEdgeColor].label}）`,
        onClick: () => setNodeEdgeColor(nodeId, getLowerEdgeColor(currentEdgeColor)),
      },
      {
        label: "重要度：重置为默认",
        onClick: () => setNodeEdgeColor(nodeId, "default"),
      },
      { label: "", onClick: () => {}, divider: true },
      {
        label: "一键传递重要度（向外递减）",
        onClick: () => propagateEdgeColorFromNode(nodeId),
      },
      { label: "", onClick: () => {}, divider: true },
      {
        label: "删除节点",
        danger: true,
        onClick: () => deleteNode(nodeId),
      },
    ];
  }

  if (menu.type === "edge" && menu.targetId) {
    const edgeId = menu.targetId;
    return [
      {
        label: "编辑标签",
        onClick: () => {
          const newLabel = prompt("输入边的标签:", "");
          if (newLabel !== null) {
            updateEdgeLabel(edgeId, newLabel);
          }
        },
      },
      { label: "", onClick: () => {}, divider: true },
      ...EDGE_LABEL_OPTIONS.map((label) => ({
        label: `快捷: ${label}`,
        onClick: () => updateEdgeLabel(edgeId, label),
      })),
      {
        label: "清除标签",
        onClick: () => updateEdgeLabel(edgeId, ""),
      },
      { label: "", onClick: () => {}, divider: true },
      {
        label: "删除连接",
        danger: true,
        onClick: () => deleteEdge(edgeId),
      },
    ];
  }

  return [];
}
