import { useCallback, useState, type FC } from "react";
import { toPng } from "html-to-image";
import { useStore } from "zustand";
import { useGraphStore, useTemporalStore } from "@/store/graphStore";
import { useTheme } from "@/hooks/useTheme";
import { exportGraphAsJsonFile, importGraphFromFile } from "@/services/graphFileTransfer";
import { exportPngDataUrl } from "@/services/imageExport";
import { CANVAS_ELEMENT_ID } from "@/constants/dom";
import SearchBar from "./SearchBar";
import KeyboardShortcutsPanel from "./KeyboardShortcutsPanel";
import SettingsPanel from "./SettingsPanel";

/**
 * 工具栏组件
 * 提供添加节点、保存、导入导出等操作
 */
const Toolbar: FC = () => {
  const addNode = useGraphStore((s) => s.addNode);
  const exportData = useGraphStore((s) => s.exportData);
  const importData = useGraphStore((s) => s.importData);
  const saveData = useGraphStore((s) => s.saveData);
  const saveStatus = useGraphStore((s) => s.saveStatus);
  const { theme, toggleTheme } = useTheme();

  // 撤销/重做
  const { undo, redo, pastStates, futureStates } = useStore(useTemporalStore);
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  // 快捷键面板
  const [showShortcuts, setShowShortcuts] = useState(false);

  // 设置面板
  const [showSettings, setShowSettings] = useState(false);

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

  // 保存状态文字
  const saveStatusText = saveStatus === "saving" ? "保存中..." : saveStatus === "saved" ? "已保存" : "";

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-border shadow-xs">
      {/* Logo */}
      <div className="flex items-center gap-2 pr-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
          <circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" />
          <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" /><line x1="15.5" y1="7.5" x2="8.5" y2="16.5" />
        </svg>
        <span className="font-semibold text-text select-none tracking-tight">GraphAndTable</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* 主操作按钮 */}
      <button
        onClick={handleAddNode}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark active:scale-[0.97] transition-all duration-150 cursor-pointer shadow-sm hover:shadow-md"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加节点
      </button>

      <div className="w-px h-5 bg-border" />

      {/* 撤销/重做按钮组 */}
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

      {/* 保存状态指示 */}
      {saveStatusText && (
        <span className={`text-[11px] select-none transition-all duration-300 font-medium ${saveStatus === "saved" ? "text-primary" : "text-text-muted animate-pulse-soft"}`}>
          {saveStatusText}
        </span>
      )}

      <div className="w-px h-5 bg-border" />

      {/* 搜索栏 */}
      <SearchBar />

      <div className="flex-1" />

      {/* 文件操作按钮组 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => saveData()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
          title="保存"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          保存
        </button>
        <button
          onClick={handleExportFile}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
          title="导出 JSON"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          导出
        </button>
        <button
          onClick={handleExportImage}
          disabled={isExportingImage}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="导出图片"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
          {isExportingImage ? "..." : "图片"}
        </button>
        <button
          onClick={handleImportFile}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted rounded-lg hover:bg-surface hover:text-text active:scale-[0.97] transition-all duration-150 cursor-pointer"
          title="导入 JSON"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          导入
        </button>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* 工具按钮组 */}
      <div className="flex items-center gap-1 bg-surface/50 rounded-lg p-0.5">
        {/* 深色模式切换 */}
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

        {/* 快捷键帮助 */}
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

        {/* 设置按钮 */}
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

      {/* 快捷键面板 */}
      <KeyboardShortcutsPanel isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* 设置面板 */}
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
};

export default Toolbar;
