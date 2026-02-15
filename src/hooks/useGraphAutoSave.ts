import { useEffect } from "react";
import { useGraphStore } from "@/store/graphStore";

interface AutoSaveOptions {
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * 图数据自动保存
 * 通过订阅 store 的 nodes/edges 变化实现去抖自动保存，避免把副作用写在 store 模块顶层。
 */
export function useGraphAutoSave(options: AutoSaveOptions = {}) {
  const { enabled = true, debounceMs = 1000 } = options;
  const saveData = useGraphStore((s) => s.saveData);
  const markSaveStatusIdle = useGraphStore((s) => s.markSaveStatusIdle);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useGraphStore.subscribe(
      (s) => ({ nodes: s.nodes, edges: s.edges }),
      (_snapshot) => {
        markSaveStatusIdle();
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          saveData();
        }, debounceMs);
      },
      { equalityFn: (a, b) => a.nodes === b.nodes && a.edges === b.edges },
    );

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, debounceMs, saveData, markSaveStatusIdle]);
}

