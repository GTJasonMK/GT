import { useCallback, useState, type FC } from "react";
import { toPng } from "html-to-image";
import { useStore } from "zustand";
import { useGraphStore, useTemporalStore } from "@/store/graphStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { exportGraphAsJsonFile, importGraphFromFile } from "@/services/graphFileTransfer";
import { exportPngDataUrl } from "@/services/imageExport";
import { parseTextToGraph } from "@/services/textToGraph";
import { CANVAS_ELEMENT_ID } from "@/constants/dom";
import { EDGE_COLORS, EDGE_COLOR_OPTIONS, NODE_COLORS, type EdgeColor, type LockMode, type NodeColor } from "@/types";
import SearchBar from "./SearchBar";
import KeyboardShortcutsPanel from "./KeyboardShortcutsPanel";
import SettingsPanel from "./SettingsPanel";

/**
 * 工具栏组件
 * 提供添加节点、保存、导入导出等操作
 */
const Toolbar: FC = () => {
  const addNode = useGraphStore((s) => s.addNode);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedNodeCount = useGraphStore((s) =>
    s.nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0)
  );
  const exportData = useGraphStore((s) => s.exportData);
  const exportSelectedNodesData = useGraphStore((s) => s.exportSelectedNodesData);
  const pathFocusNodeIds = useGraphStore((s) => s.pathFocusNodeIds);
  const applyBatchEditToSelectedNodes = useGraphStore((s) => s.applyBatchEditToSelectedNodes);
  const focusShortestPathBetweenSelectedNodes = useGraphStore((s) => s.focusShortestPathBetweenSelectedNodes);
  const clearPathFocus = useGraphStore((s) => s.clearPathFocus);
  const importData = useGraphStore((s) => s.importData);
  const saveData = useGraphStore((s) => s.saveData);
  const saveStatus = useGraphStore((s) => s.saveStatus);
  const globalEdgeFlowAnimation = useSettingsStore((s) => s.layout.globalEdgeFlowAnimation);
  const setLayoutSettings = useSettingsStore((s) => s.setLayoutSettings);
  const { theme, toggleTheme } = useTheme();

  // 撤销/重做
  const { undo, redo, pastStates, futureStates } = useStore(useTemporalStore);
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  // 快捷键面板
  const [showShortcuts, setShowShortcuts] = useState(false);

  // 设置面板
  const [showSettings, setShowSettings] = useState(false);
  const [showTextToGraphModal, setShowTextToGraphModal] = useState(false);
  const [textToGraphTitle, setTextToGraphTitle] = useState("");
  const [textToGraphInput, setTextToGraphInput] = useState("");
  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [batchNodeColorEnabled, setBatchNodeColorEnabled] = useState(false);
  const [batchNodeColor, setBatchNodeColor] = useState<NodeColor>("default");
  const [batchEdgeColorEnabled, setBatchEdgeColorEnabled] = useState(false);
  const [batchEdgeColor, setBatchEdgeColor] = useState<EdgeColor>("default");
  const [batchTagsMode, setBatchTagsMode] = useState<"none" | "append" | "replace">("none");
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [batchLockMode, setBatchLockMode] = useState<"none" | "lock" | "unlock">("none");
  const [batchLockScope, setBatchLockScope] = useState<LockMode>("direct");
  const [batchLockDepth, setBatchLockDepth] = useState(2);

  // 添加新节点到画布中央
  const handleAddNode = useCallback(() => {
    addNode({ x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 });
  }, [addNode]);

  // 导出为 JSON 文件
  const handleExportFile = useCallback(async () => {
    try {
      await exportGraphAsJsonFile(exportData());
    } catch (error) {
      console.error("导出失败:", error);
      alert("导出失败，请重试");
    }
  }, [exportData]);

  const handleExportSelectedSubgraph = useCallback(async () => {
    try {
      const selectedGraph = exportSelectedNodesData();
      if (!selectedGraph) {
        alert("请先选中一个或多个节点，再执行导出");
        return;
      }
      await exportGraphAsJsonFile(selectedGraph, `graph_selected_nodes_${Date.now()}.json`);
    } catch (error) {
      console.error("导出选中节点失败:", error);
      alert("导出选中节点失败，请重试");
    }
  }, [exportSelectedNodesData]);

  // 从文件导入（Graph JSON / Drawnix）
  const handleImportFile = useCallback(async () => {
    try {
      const result = await importGraphFromFile();
      if (!result) {
        alert("导入失败：不支持的文件或格式错误");
        return;
      }
      importData(result.graph);

      if (result.warnings.length > 0) {
        console.warn("[导入警告]", result.warnings);
        alert(
          `导入完成：${result.graph.nodes.length} 节点，${result.graph.edges.length} 连线。\n` +
            `其中 ${result.warnings.length} 条内容未完全转换，已输出到控制台。`,
        );
      }
    } catch (error) {
      console.error("导入失败:", error);
      alert("导入失败：不支持的文件或格式错误");
    }
  }, [importData]);

  // 导出图片状态
  const [isExportingImage, setIsExportingImage] = useState(false);

  // 导出为 PNG 图片
  const handleExportImage = useCallback(async () => {
    const reactFlowElement = document.getElementById(CANVAS_ELEMENT_ID) as HTMLElement | null;
    if (!reactFlowElement) {
      alert("无法找到画布元素");
      return;
    }

    setIsExportingImage(true);
    try {
      const backgroundColor = theme === "dark" ? "#0F172A" : "#F8FAFC";
      const dataUrl = await toPng(reactFlowElement, {
        backgroundColor,
        quality: 1,
        pixelRatio: 2,
      });
      await exportPngDataUrl(dataUrl);
    } catch (error) {
      console.error("导出图片失败:", error);
      alert("导出图片失败，请重试");
    } finally {
      setIsExportingImage(false);
    }
  }, [theme]);

  const handleGenerateGraphFromText = useCallback(() => {
    const input = textToGraphInput.trim();
    if (!input) {
      alert("请输入知识点内容后再生成");
      return;
    }

    const graph = parseTextToGraph(input, { sourceLabel: textToGraphTitle.trim() || "输入知识主题" });
    if (!graph) {
      alert("无法解析输入内容，请补充更多知识点");
      return;
    }

    importData(graph);
    setShowTextToGraphModal(false);
    setTextToGraphInput("");
    setTextToGraphTitle("");
  }, [importData, textToGraphInput, textToGraphTitle]);

  // 保存状态文字
  const saveStatusText = saveStatus === "saving" ? "保存中..." : saveStatus === "saved" ? "已保存" : "";
  const effectiveSelectedCount = selectedNodeCount > 0 ? selectedNodeCount : selectedNodeId ? 1 : 0;
  const canExportSelectedNodes = effectiveSelectedCount > 0;
  const canBatchEdit = effectiveSelectedCount > 0;
  const canFocusPath = selectedNodeCount === 2;
  const hasPathFocus = pathFocusNodeIds.length > 0;

  const nodeColorOptions = Object.keys(NODE_COLORS) as NodeColor[];

  const resetBatchEditDraft = useCallback(() => {
    setBatchNodeColorEnabled(false);
    setBatchNodeColor("default");
    setBatchEdgeColorEnabled(false);
    setBatchEdgeColor("default");
    setBatchTagsMode("none");
    setBatchTagsInput("");
    setBatchLockMode("none");
    setBatchLockScope("direct");
    setBatchLockDepth(2);
  }, []);

  const handleToggleGlobalFlowAnimation = useCallback(() => {
    setLayoutSettings({ globalEdgeFlowAnimation: !globalEdgeFlowAnimation });
  }, [globalEdgeFlowAnimation, setLayoutSettings]);

  const handleFocusPath = useCallback(() => {
    const result = focusShortestPathBetweenSelectedNodes();
    if (!result.ok) {
      alert(result.message);
      return;
    }
    alert(result.message);
  }, [focusShortestPathBetweenSelectedNodes]);

  const handleClearPathFocus = useCallback(() => {
    clearPathFocus();
  }, [clearPathFocus]);

  const parseBatchTags = useCallback((): string[] => {
    return Array.from(
      new Set(
        batchTagsInput
          .split(/[，,\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    );
  }, [batchTagsInput]);

  const handleSubmitBatchEdit = useCallback(() => {
    const payload: {
      color?: NodeColor;
      edgeColor?: EdgeColor;
      appendTags?: string[];
      replaceTags?: string[];
      lock?: {
        enabled: boolean;
        mode?: LockMode;
        depth?: number;
      };
    } = {};

    if (batchNodeColorEnabled) {
      payload.color = batchNodeColor;
    }

    if (batchEdgeColorEnabled) {
      payload.edgeColor = batchEdgeColor;
    }

    if (batchTagsMode !== "none") {
      const tags = parseBatchTags();
      if (tags.length === 0) {
        alert("请输入至少一个标签（支持逗号或换行分隔）。");
        return;
      }
      if (batchTagsMode === "append") {
        payload.appendTags = tags;
      } else {
        payload.replaceTags = tags;
      }
    }

    if (batchLockMode === "lock") {
      payload.lock = {
        enabled: true,
        mode: batchLockScope,
        depth: batchLockScope === "level" ? Math.max(1, Math.floor(batchLockDepth)) : undefined,
      };
    } else if (batchLockMode === "unlock") {
      payload.lock = { enabled: false };
    }

    const result = applyBatchEditToSelectedNodes(payload);
    alert(result.message);
    if (!result.ok) return;

    setShowBatchEditModal(false);
    resetBatchEditDraft();
  }, [
    batchNodeColorEnabled,
    batchNodeColor,
    batchEdgeColorEnabled,
    batchEdgeColor,
    batchTagsMode,
    parseBatchTags,
    batchLockMode,
    batchLockScope,
    batchLockDepth,
    applyBatchEditToSelectedNodes,
    resetBatchEditDraft,
  ]);

  return (
    <div className="bg-white border-b border-border shadow-xs">
      <div className="px-4 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-1">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" />
              <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" /><line x1="15.5" y1="7.5" x2="8.5" y2="16.5" />
            </svg>
            <span className="font-semibold text-text select-none tracking-tight">GraphAndTable</span>
          </div>

          <button
            onClick={handleAddNode}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark active:scale-[0.97] transition-all duration-150 cursor-pointer shadow-sm hover:shadow-md"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            添加节点
          </button>

          <div className="flex items-center gap-1 bg-surface/50 rounded-lg p-0.5">
            <button
              onClick={() => undo()}
              disabled={!canUndo}
              className="flex items-center justify-center w-7 h-7 text-text-muted rounded-md hover:bg-white hover:text-text hover:shadow-sm active:scale-[0.95] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none"
              title="撤销 (Ctrl+Z)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 7" />
              </svg>
            </button>
            <button
              onClick={() => redo()}
              disabled={!canRedo}
              className="flex items-center justify-center w-7 h-7 text-text-muted rounded-md hover:bg-white hover:text-text hover:shadow-sm active:scale-[0.95] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none"
              title="重做 (Ctrl+Y)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" /><path d="M21 13a9 9 0 1 1-3-7.7L21 7" />
              </svg>
            </button>
          </div>

          {saveStatusText && (
            <span className={`text-[11px] select-none transition-all duration-300 font-medium ${saveStatus === "saved" ? "text-primary" : "text-text-muted animate-pulse-soft"}`}>
              {saveStatusText}
            </span>
          )}

          <div className="min-w-[220px] flex-1">
            <SearchBar />
          </div>

          <div className="flex items-center gap-1 bg-surface/50 rounded-lg p-0.5">
            <button
              onClick={handleToggleGlobalFlowAnimation}
              className={`flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 cursor-pointer ${
                globalEdgeFlowAnimation
                  ? "bg-primary/15 text-primary shadow-sm"
                  : "text-text-muted hover:bg-white hover:text-text hover:shadow-sm"
              }`}
              title={globalEdgeFlowAnimation ? "关闭全局连线流向动画" : "开启全局连线流向动画"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h14" />
                <path d="M13 7l5 5-5 5" />
                <path d="M3 6h8" />
                <path d="M3 18h8" />
              </svg>
            </button>

            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-7 h-7 text-text-muted rounded-md hover:bg-white hover:text-text hover:shadow-sm active:scale-[0.95] transition-all duration-150 cursor-pointer"
              title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            >
              {theme === "dark" ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            <button
              onClick={() => setShowShortcuts(true)}
              className="flex items-center justify-center w-7 h-7 text-text-muted rounded-md hover:bg-white hover:text-text hover:shadow-sm active:scale-[0.95] transition-all duration-150 cursor-pointer"
              title="快捷键帮助"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-7 h-7 text-text-muted rounded-md hover:bg-white hover:text-text hover:shadow-sm active:scale-[0.95] transition-all duration-150 cursor-pointer"
              title="设置"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-border/70">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <button
              onClick={() => saveData()}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
              title="保存"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              保存
            </button>
            <button
              onClick={handleExportFile}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
              title="导出 JSON"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              导出
            </button>
            <button
              onClick={handleExportSelectedSubgraph}
              disabled={!canExportSelectedNodes}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={canExportSelectedNodes
                ? `导出当前选中节点集合（已选 ${effectiveSelectedCount} 个）`
                : "请先选中节点（支持框选多个）"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><line x1="8" y1="12" x2="16" y2="7" /><line x1="8" y1="12" x2="16" y2="17" /></svg>
              {canExportSelectedNodes ? `导出选中(${effectiveSelectedCount})` : "导出选中"}
            </button>
            <button
              onClick={() => setShowBatchEditModal(true)}
              disabled={!canBatchEdit}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={canBatchEdit ? `批量编辑当前选中节点（${effectiveSelectedCount} 个）` : "请先选中一个或多个节点"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1" /><rect x="3" y="15" width="18" height="5" rx="1" /><path d="M9 9v6" /><path d="M15 9v6" /></svg>
              {canBatchEdit ? `批量编辑(${effectiveSelectedCount})` : "批量编辑"}
            </button>
            <button
              onClick={handleFocusPath}
              disabled={!canFocusPath}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={canFocusPath ? "在两个选中节点之间聚焦最短路径" : "请先框选两个节点再聚焦路径"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h5l2-3 4 6 2-3h5" /><circle cx="3" cy="12" r="1.5" /><circle cx="21" cy="12" r="1.5" /></svg>
              {canFocusPath ? "聚焦路径(2)" : "聚焦路径"}
            </button>
            <button
              onClick={handleClearPathFocus}
              disabled={!hasPathFocus}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasPathFocus ? "清除当前路径聚焦" : "当前没有路径聚焦"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="4" x2="20" y2="20" /><path d="M3 12h5l2-3 4 6 2-3h5" /></svg>
              清除聚焦
            </button>
            <button
              onClick={handleExportImage}
              disabled={isExportingImage}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="导出图片"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
              {isExportingImage ? "..." : "图片"}
            </button>
            <button
              onClick={handleImportFile}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
              title="导入 JSON"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              导入
            </button>
            <button
              onClick={() => setShowTextToGraphModal(true)}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
              title="输入文本自动转知识图谱"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M3 12h18" /><circle cx="12" cy="12" r="9" /></svg>
              文本转图
            </button>
          </div>
        </div>
      </div>

      {/* 快捷键面板 */}
      <KeyboardShortcutsPanel isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* 设置面板 */}
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* 文本转图谱弹窗 */}
      {showTextToGraphModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" onClick={() => setShowTextToGraphModal(false)}>
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-border p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-text">输入知识点生成图谱</div>
              <button
                onClick={() => setShowTextToGraphModal(false)}
                className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <input
              type="text"
              value={textToGraphTitle}
              onChange={(e) => setTextToGraphTitle(e.target.value)}
              placeholder="主题（可选，例如：机器学习）"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary/20 mb-3"
            />

            <textarea
              value={textToGraphInput}
              onChange={(e) => setTextToGraphInput(e.target.value)}
              placeholder={"输入知识点，或输入你想了解的主题，每行一个或用中文逗号分隔。\n示例：\n监督学习\n无监督学习\n模型评估\n过拟合\n交叉验证"}
              className="w-full min-h-[220px] px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary/20 resize-y"
            />

            <div className="mt-3 flex justify-between items-center text-xs text-text-muted">
              <span>将基于输入自动生成中心节点 + 关联子节点结构（可再手动编辑）</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowTextToGraphModal(false)}
                  className="px-3 py-1.5 rounded-md border border-border hover:bg-surface transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleGenerateGraphFromText}
                  className="px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors cursor-pointer"
                >
                  生成图谱
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量编辑弹窗 */}
      {showBatchEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" onClick={() => setShowBatchEditModal(false)}>
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-border p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-text">批量编辑节点（已选 {effectiveSelectedCount} 个）</div>
              <button
                onClick={() => setShowBatchEditModal(false)}
                className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface/30 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-text mb-2">
                  <input type="checkbox" checked={batchNodeColorEnabled} onChange={(e) => setBatchNodeColorEnabled(e.target.checked)} />
                  批量设置节点颜色
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {nodeColorOptions.map((color) => (
                    <button
                      key={color}
                      onClick={() => setBatchNodeColor(color)}
                      disabled={!batchNodeColorEnabled}
                      className={`w-6 h-6 rounded-full cursor-pointer transition-all duration-150 ring-1 ring-black/10 disabled:opacity-40 disabled:cursor-not-allowed ${batchNodeColor === color ? "ring-2 ring-primary ring-offset-2" : ""}`}
                      style={{ backgroundColor: NODE_COLORS[color].border }}
                      title={color === "default" ? "默认" : color}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface/30 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-text mb-2">
                  <input type="checkbox" checked={batchEdgeColorEnabled} onChange={(e) => setBatchEdgeColorEnabled(e.target.checked)} />
                  批量设置连线重要度颜色
                </label>
                <select
                  value={batchEdgeColor}
                  onChange={(e) => setBatchEdgeColor(e.target.value as EdgeColor)}
                  disabled={!batchEdgeColorEnabled}
                  className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {EDGE_COLOR_OPTIONS.map((color) => (
                    <option key={color} value={color}>{EDGE_COLORS[color].label}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-border bg-surface/30 p-3">
                <div className="text-sm font-medium text-text mb-2">批量处理标签</div>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setBatchTagsMode("none")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchTagsMode === "none" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >不处理</button>
                  <button
                    onClick={() => setBatchTagsMode("append")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchTagsMode === "append" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >追加标签</button>
                  <button
                    onClick={() => setBatchTagsMode("replace")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchTagsMode === "replace" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >替换标签</button>
                </div>
                <textarea
                  value={batchTagsInput}
                  onChange={(e) => setBatchTagsInput(e.target.value)}
                  disabled={batchTagsMode === "none"}
                  placeholder="输入标签，支持逗号或换行分隔"
                  className="w-full min-h-[72px] px-2.5 py-2 text-xs rounded-md border border-border bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="rounded-lg border border-border bg-surface/30 p-3">
                <div className="text-sm font-medium text-text mb-2">批量锁定设置</div>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setBatchLockMode("none")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchLockMode === "none" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >不处理</button>
                  <button
                    onClick={() => setBatchLockMode("lock")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchLockMode === "lock" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >统一锁定</button>
                  <button
                    onClick={() => setBatchLockMode("unlock")}
                    className={`px-2 py-1 text-xs rounded-md border cursor-pointer ${batchLockMode === "unlock" ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-white"}`}
                  >统一解锁</button>
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    value={batchLockScope}
                    onChange={(e) => setBatchLockScope(e.target.value as LockMode)}
                    disabled={batchLockMode !== "lock"}
                    className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-border bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="direct">相邻子节点</option>
                    <option value="level">固定层级</option>
                    <option value="transitive">所有可达子节点</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={batchLockDepth}
                    onChange={(e) => setBatchLockDepth(Number(e.target.value))}
                    disabled={batchLockMode !== "lock" || batchLockScope !== "level"}
                    className="w-20 px-2 py-1.5 text-xs rounded-md border border-border bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
              <span>提示：默认不处理未勾选项，只应用你启用的批量动作</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    resetBatchEditDraft();
                    setShowBatchEditModal(false);
                  }}
                  className="px-3 py-1.5 rounded-md border border-border hover:bg-surface transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmitBatchEdit}
                  className="px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors cursor-pointer"
                >
                  应用批量编辑
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;
