import type { ContextMenuItem } from "../ContextMenu";

export interface GraphContextMenuState {
  x: number;
  y: number;
  type: "pane" | "node" | "edge";
  targetId?: string;
}

interface BuildGraphContextMenuItemsArgs {
  menu: GraphContextMenuState;

  addNodeFromClientPoint: (clientX: number, clientY: number) => void;

  setSelectedNodeId: (nodeId: string | null) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;

  updateEdgeLabel: (edgeId: string, label: string) => void;
  deleteEdge: (edgeId: string) => void;
}

const EDGE_LABEL_OPTIONS = ["相关", "前置", "扩展", "包含"];

export function buildGraphContextMenuItems(args: BuildGraphContextMenuItemsArgs): ContextMenuItem[] {
  const {
    menu,
    addNodeFromClientPoint,
    setSelectedNodeId,
    duplicateNode,
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

    return [
      {
        label: "编辑节点",
        onClick: () => setSelectedNodeId(nodeId),
      },
      {
        label: "复制节点",
        onClick: () => duplicateNode(nodeId),
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
