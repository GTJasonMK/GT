import { useEffect } from "react";
import { useGraphStore } from "@/store/graphStore";
import { useTemporalStore } from "@/store/graphStore";
import { SEARCH_INPUT_ID } from "@/constants/dom";

/**
 * 全局键盘快捷键钩子
 * - Ctrl+S: 保存
 * - Ctrl+Z: 撤销
 * - Ctrl+Y / Ctrl+Shift+Z: 重做
 * - Ctrl+D: 复制选中节点
 * - Ctrl+F: 聚焦搜索框
 * - Escape: 取消选中 / 清空搜索
 * - Delete/Backspace: 删除选中节点（由ReactFlow处理）
 */
export const useKeyboardShortcuts = () => {
  const saveData = useGraphStore((s) => s.saveData);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的快捷键（除了特定的）
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Ctrl+S: 保存
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveData();
        return;
      }

      // Ctrl+Z: 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const { undo } = useTemporalStore.getState();
        undo();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z: 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        const { redo } = useTemporalStore.getState();
        redo();
        return;
      }

      // Ctrl+D: 复制选中节点
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && !isInput) {
        e.preventDefault();
        if (selectedNodeId) {
          duplicateNode(selectedNodeId);
        }
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
  }, [saveData, setSelectedNodeId, setSearchQuery, searchQuery, selectedNodeId, duplicateNode]);
};
