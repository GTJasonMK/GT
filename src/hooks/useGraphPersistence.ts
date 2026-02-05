import { useEffect } from "react";
import { useGraphStore } from "@/store/graphStore";

/**
 * 图数据持久化（初始化加载）
 * 将“启动时加载”从具体组件中抽离，避免 UI 组件承担跨层职责。
 */
export function useGraphPersistence() {
  const loadData = useGraphStore((s) => s.loadData);

  useEffect(() => {
    loadData();
  }, [loadData]);
}

