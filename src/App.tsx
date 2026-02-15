import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FC } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Toolbar from "./components/Toolbar";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useGraphPersistence } from "./hooks/useGraphPersistence";
import { useGraphAutoSave } from "./hooks/useGraphAutoSave";
import { useSettingsStore, PANEL_WIDTH_LIMITS } from "./store/settingsStore";

const GraphCanvas = lazy(() => import("./components/GraphCanvas"));
const NodeOutline = lazy(() => import("./components/NodeOutline"));
const EditorPanel = lazy(() => import("./components/EditorPanel"));

const AppContent: FC = () => {
  useKeyboardShortcuts();
  useGraphPersistence();
  useGraphAutoSave();

  const leftPanelWidth = useSettingsStore((s) => s.panel.leftPanelWidth);
  const rightPanelWidth = useSettingsStore((s) => s.panel.rightPanelWidth);
  const setPanelSettings = useSettingsStore((s) => s.setPanelSettings);

  // 拖拽状态
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  // 左侧面板拖拽开始
  const handleLeftDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDraggingLeft(true);
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = leftPanelWidth;
    },
    [leftPanelWidth],
  );

  // 右侧面板拖拽开始
  const handleRightDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDraggingRight(true);
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = rightPanelWidth;
    },
    [rightPanelWidth],
  );

  // 鼠标移动处理
  useEffect(() => {
    if (!isDraggingLeft && !isDraggingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const delta = e.clientX - dragStartXRef.current;
        const newWidth = Math.min(
          Math.max(dragStartWidthRef.current + delta, PANEL_WIDTH_LIMITS.left.min),
          PANEL_WIDTH_LIMITS.left.max,
        );
        setPanelSettings({ leftPanelWidth: newWidth });
      } else if (isDraggingRight) {
        const delta = dragStartXRef.current - e.clientX;
        const newWidth = Math.min(
          Math.max(dragStartWidthRef.current + delta, PANEL_WIDTH_LIMITS.right.min),
          PANEL_WIDTH_LIMITS.right.max,
        );
        setPanelSettings({ rightPanelWidth: newWidth });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingLeft, isDraggingRight, setPanelSettings]);

  // 双击重置宽度
  const handleLeftDoubleClick = useCallback(() => {
    setPanelSettings({ leftPanelWidth: 224 });
  }, [setPanelSettings]);

  const handleRightDoubleClick = useCallback(() => {
    setPanelSettings({ rightPanelWidth: 320 });
  }, [setPanelSettings]);

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas">
      {/* 顶部工具栏 */}
      <Toolbar />

      {/* 主内容区：左侧大纲 + 中间画布 + 右侧编辑面板 */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧节点大纲 */}
        <div
          className="bg-white border-r border-border flex flex-col shrink-0"
          style={{ width: leftPanelWidth }}
        >
          <Suspense
            fallback={<div className="h-full flex items-center justify-center text-xs text-text-muted">加载节点大纲中...</div>}
          >
            <NodeOutline />
          </Suspense>
        </div>

        {/* 左侧拖拽手柄 */}
        <div
          onMouseDown={handleLeftDragStart}
          onDoubleClick={handleLeftDoubleClick}
          className={`w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 relative group
            ${isDraggingLeft ? "bg-primary/50" : "bg-transparent"}
          `}
          title="拖拽调整宽度，双击重置"
        >
          {/* 拖拽指示器 */}
          <div className="absolute inset-y-0 -left-0.5 -right-0.5 group-hover:bg-primary/10" />
        </div>

        {/* 图画布 */}
        <div className="flex-1 min-w-0">
          <Suspense
            fallback={<div className="h-full flex items-center justify-center text-xs text-text-muted">加载图画布中...</div>}
          >
            <GraphCanvas />
          </Suspense>
        </div>

        {/* 右侧拖拽手柄 */}
        <div
          onMouseDown={handleRightDragStart}
          onDoubleClick={handleRightDoubleClick}
          className={`w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 relative group
            ${isDraggingRight ? "bg-primary/50" : "bg-transparent"}
          `}
          title="拖拽调整宽度，双击重置"
        >
          {/* 拖拽指示器 */}
          <div className="absolute inset-y-0 -left-0.5 -right-0.5 group-hover:bg-primary/10" />
        </div>

        {/* 右侧编辑面板 */}
        <div
          className="bg-white border-l border-border flex flex-col shrink-0"
          style={{ width: rightPanelWidth }}
        >
          <Suspense
            fallback={<div className="flex-1 flex items-center justify-center text-xs text-text-muted">加载节点面板中...</div>}
          >
            <EditorPanel />
          </Suspense>
        </div>
      </div>

      {/* 拖拽时的全局覆盖层，防止鼠标进入 iframe 等元素导致拖拽中断 */}
      {(isDraggingLeft || isDraggingRight) && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
    </div>
  );
};

const App: FC = () => {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
};

export default App;
