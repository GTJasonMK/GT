import { useEffect, useRef, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraphStore } from "@/store/graphStore";
import { useSettingsStore } from "@/store/settingsStore";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

/**
 * 画布交互 hook
 * 实现类似 Unreal/Unity 引擎的操作方式：
 * - 右键按住 + WASD 平移画布
 * - F 键聚焦选中节点
 * - 区分右键单击（上下文菜单）和右键+WASD（平移）
 * - 触摸屏：双指滑动平移（通过 panOnScroll），双指捏合缩放（通过 visualViewport 检测）
 * - 缩放：Controls 按钮、Ctrl+滚轮、或触摸屏捏合
 */
export function useCanvasInteraction() {
  const { getViewport, setViewport, fitView, getNodes, getZoom, zoomTo } = useReactFlow();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  // 用 ref 存储设置，确保回调函数始终读取最新值
  const settingsRef = useRef(useSettingsStore.getState().canvas);
  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      settingsRef.current = state.canvas;
    });
  }, []);

  // 鼠标状态追踪
  const isRightMouseDownRef = useRef(false);
  const hasMovedWithWASDRef = useRef(false);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const animationFrameRef = useRef<number | null>(null);

  // visualViewport 缩放追踪（用于触摸屏捏合缩放）
  const lastVisualScaleRef = useRef(1);

  // 缩放：计算目标 zoom 值，交给 ReactFlow 的 zoomTo 处理中心点
  const doZoom = useCallback((isZoomIn: boolean) => {
    const currentZoom = getZoom();
    const factor = isZoomIn ? settingsRef.current.zoomFactor : 1 / settingsRef.current.zoomFactor;
    const newZoom = Math.min(Math.max(currentZoom * factor, ZOOM_MIN), ZOOM_MAX);
    zoomTo(newZoom);
  }, [getZoom, zoomTo]);

  // 检查是否在输入框中
  const isInInputElement = useCallback(() => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    const tagName = activeElement.tagName.toLowerCase();
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      (activeElement as HTMLElement).isContentEditable
    );
  }, []);

  // 平移动画循环
  const updatePan = useCallback(() => {
    if (!isRightMouseDownRef.current) {
      animationFrameRef.current = null;
      return;
    }

    const keys = pressedKeysRef.current;
    const viewport = getViewport();
    const panSpeed = settingsRef.current.panSpeed;
    let dx = 0;
    let dy = 0;

    if (keys.has("w") || keys.has("arrowup")) dy = panSpeed;
    if (keys.has("s") || keys.has("arrowdown")) dy = -panSpeed;
    if (keys.has("a") || keys.has("arrowleft")) dx = panSpeed;
    if (keys.has("d") || keys.has("arrowright")) dx = -panSpeed;

    if (dx !== 0 || dy !== 0) {
      hasMovedWithWASDRef.current = true;
      const adjustedDx = dx / viewport.zoom;
      const adjustedDy = dy / viewport.zoom;
      setViewport({
        x: viewport.x + adjustedDx,
        y: viewport.y + adjustedDy,
        zoom: viewport.zoom,
      });
    }

    animationFrameRef.current = requestAnimationFrame(updatePan);
  }, [getViewport, setViewport]);

  // 开始平移动画
  const startPanAnimation = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(updatePan);
    }
  }, [updatePan]);

  // 停止平移动画
  const stopPanAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // 判断是否应该显示上下文菜单
  const shouldShowContextMenu = useCallback(() => {
    return !hasMovedWithWASDRef.current;
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = true;
        hasMovedWithWASDRef.current = false;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = false;
        stopPanAnimation();
        pressedKeysRef.current.clear();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // F 键聚焦
      if (key === "f" && !isInInputElement()) {
        e.preventDefault();
        const nodes = getNodes();
        if (selectedNodeId) {
          const selectedNode = nodes.find((n) => n.id === selectedNodeId);
          if (selectedNode) {
            fitView({
              nodes: [selectedNode],
              duration: 300,
              padding: 0.5,
            });
          }
        } else if (nodes.length > 0) {
          fitView({
            duration: 300,
            padding: 0.2,
          });
        }
        return;
      }

      // WASD / 方向键平移（仅在右键按住时）
      if (isRightMouseDownRef.current && !isInInputElement()) {
        if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
          e.preventDefault();
          pressedKeysRef.current.add(key);
          startPanAnimation();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      pressedKeysRef.current.delete(key);

      const movementKeys = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
      const hasMovementKey = movementKeys.some((k) => pressedKeysRef.current.has(k));
      if (!hasMovementKey) {
        stopPanAnimation();
      }
    };

    const handleBlur = () => {
      isRightMouseDownRef.current = false;
      hasMovedWithWASDRef.current = false;
      pressedKeysRef.current.clear();
      stopPanAnimation();
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (hasMovedWithWASDRef.current) {
        e.preventDefault();
      }
    };

    // Ctrl+滚轮缩放
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        doZoom(e.deltaY < 0);
      }
    };

    // visualViewport 缩放处理（WebView2 pinch zoom 会改变这个值）
    const handleVisualViewportResize = () => {
      if (!window.visualViewport) return;

      const currentScale = window.visualViewport.scale;
      const lastScale = lastVisualScaleRef.current;

      if (Math.abs(currentScale - lastScale) > 0.02) {
        doZoom(currentScale > lastScale);
        lastVisualScaleRef.current = currentScale;
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });

    // 监听 visualViewport 变化（用于触摸屏捏合缩放）
    let pollInterval: number | null = null;
    if (window.visualViewport) {
      lastVisualScaleRef.current = window.visualViewport.scale;
      window.visualViewport.addEventListener("resize", handleVisualViewportResize);

      pollInterval = window.setInterval(() => {
        handleVisualViewportResize();
      }, 50);
    }

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("wheel", handleWheel, { capture: true });

      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleVisualViewportResize);
      }
      if (pollInterval !== null) {
        clearInterval(pollInterval);
      }

      stopPanAnimation();
    };
  }, [
    getNodes,
    getViewport,
    setViewport,
    selectedNodeId,
    fitView,
    doZoom,
    isInInputElement,
    startPanAnimation,
    stopPanAnimation,
  ]);

  return {
    shouldShowContextMenu,
  };
}
