import { useCallback, useEffect } from "react";
import { useGraphStore } from "@/store/graphStore";
import { useTemporalStore } from "@/store/graphStore";
import { SEARCH_INPUT_ID } from "@/constants/dom";
import { toast } from "@/store/toastStore";
import { graphWorkspaceRuntime } from "@/agent/graphWorkspaceRuntime";

/**
 * 全局键盘快捷键钩子
 * - Ctrl+S: 保存
 * - Ctrl+Z: 撤销
 * - Ctrl+Y / Ctrl+Shift+Z: 重做
 * - Ctrl+D: 复制选中节点
 * - Ctrl+F: 聚焦搜索框
 * - Escape: 取消选中 / 清空搜索
 * - Delete/Backspace: 删除选中节点或连线（统一走 bridge action）
 */
export const useKeyboardShortcuts = () => {
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const searchQuery = useGraphStore((s) => s.searchQuery);

  const deleteSelectedGraphItems = useCallback(async () => {
    const { nodes, edges, selectedNodeId } = useGraphStore.getState();
    const selectedNodeIds = nodes
      .filter((node) => Boolean(node.selected))
      .map((node) => node.id);

    if (selectedNodeIds.length === 0 && selectedNodeId && nodes.some((node) => node.id === selectedNodeId)) {
      selectedNodeIds.push(selectedNodeId);
    }

    const selectedNodeIdSet = new Set(selectedNodeIds);
    const selectedEdgeIds = edges
      .filter((edge) =>
        Boolean(edge.selected)
        && !selectedNodeIdSet.has(edge.source)
        && !selectedNodeIdSet.has(edge.target))
      .map((edge) => edge.id);

    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) {
      return;
    }

    if (selectedNodeIds.length > 0) {
      const result = await graphWorkspaceRuntime.actions.deleteNodes({
        actor: "human",
        nodeIds: selectedNodeIds,
      });
      if (!result.ok) {
        toast.warning(result.error?.message || "删除节点失败");
        return;
      }
    }

    if (selectedEdgeIds.length > 0) {
      const result = await graphWorkspaceRuntime.actions.deleteEdges({
        actor: "human",
        edgeIds: selectedEdgeIds,
      });
      if (!result.ok) {
        toast.warning(result.error?.message || "删除连线失败");
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的快捷键（除了特定的）
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Ctrl+S: 保存
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void graphWorkspaceRuntime.actions.saveWorkspace({
          actor: "human",
          reason: "keyboard-shortcut",
        }).then((result) => {
          if (!result.ok) {
            toast.error(result.error?.message || "保存失败，请重试");
          }
        });
        return;
      }

      // Ctrl+Z: 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && !isInput) {
        e.preventDefault();
        const { undo } = useTemporalStore.getState();
        undo();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z: 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey)) && !isInput) {
        e.preventDefault();
        const { redo } = useTemporalStore.getState();
        redo();
        return;
      }

      // Ctrl+D: 复制选中节点
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && !isInput) {
        e.preventDefault();
        void graphWorkspaceRuntime.actions.duplicateNodes({
          actor: "human",
        }).then((result) => {
          if (!result.ok) {
            toast.warning(result.error?.message || "复制选中节点失败");
          }
        });
        return;
      }

      // Delete/Backspace: 删除选中节点或连线，统一走 bridge action
      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        e.preventDefault();
        void deleteSelectedGraphItems();
        return;
      }

      // Ctrl+F: 聚焦搜索框
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const searchInput = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Escape: 取消选中 / 清空搜索
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
        } else if (!isInput) {
          setSelectedNodeId(null);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelectedGraphItems, setSelectedNodeId, setSearchQuery, searchQuery]);
};
