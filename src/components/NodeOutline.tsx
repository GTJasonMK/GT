import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useGraphStore } from "@/store/graphStore";
import type { KnowledgeNodeData, NodeColor } from "@/types";
import { NODE_COLORS } from "@/types";
import NodeRow from "./nodeOutline/NodeRow";
import { buildConnectionInfo, computeNodeGroups, computeNodeOutlineStats } from "@/lib/nodeOutline";
import { useFocusNode } from "@/hooks/useFocusNode";
import type { Node } from "@xyflow/react";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;

function areNodesEqualByIdAndData(prev: GraphNode[], next: GraphNode[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.id !== next[i]?.id) return false;
    if (prev[i]?.data !== next[i]?.data) return false;
  }
  return true;
}

/**
 * 节点大纲视图
 * 显示所有节点的列表，支持快速定位、筛选和关系可视化
 */
const NodeOutline: FC = () => {
  const focusNode = useFocusNode();
  const [showStats, setShowStats] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterColor, setFilterColor] = useState<NodeColor | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const hasInitializedExpandedGroupsRef = useRef(false);

  const nodes = useStoreWithEqualityFn(useGraphStore, (s) => s.nodes, areNodesEqualByIdAndData);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);

  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);

  // 计算每个节点的连接信息
  const connectionInfo = useMemo(() => {
    return buildConnectionInfo(nodeIds, edges);
  }, [nodeIds, edges]);

  const groups = useMemo(() => {
    return computeNodeGroups(nodeIds, edges, connectionInfo);
  }, [nodeIds, edges, connectionInfo]);

  // 计算统计信息
  const stats = useMemo(() => {
    return computeNodeOutlineStats(nodes);
  }, [nodes]);

  // 默认展开前 3 个群组（在数据加载完成后执行一次）
  useEffect(() => {
    if (hasInitializedExpandedGroupsRef.current) return;
    if (groups.connected.length === 0) return;
    hasInitializedExpandedGroupsRef.current = true;
    setExpandedGroups(new Set(groups.connected.slice(0, 3).map((g) => g.id)));
  }, [groups.connected]);

  // 点击节点定位到画布
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      // 这里取最新 nodes，避免“仅位置变化”时大纲不重渲染导致定位到旧坐标
      const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNodeId(nodeId);
        focusNode(node);
      }
    },
    [setSelectedNodeId, focusNode],
  );

  // 清除所有筛选
  const clearFilters = useCallback(() => {
    setFilterTag(null);
    setFilterColor(null);
  }, []);

  // 是否有活动筛选
  const hasActiveFilter = filterTag !== null || filterColor !== null;

  // 切换群组展开状态
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // 切换节点连接详情展开状态
  const toggleConnectionExpand = useCallback((nodeId: string) => {
    setExpandedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // 根据节点ID获取节点数据
  const getNodeById = useCallback(
    (nodeId: string) => nodes.find((n) => n.id === nodeId),
    [nodes],
  );

  const getNodeLabel = useCallback(
    (nodeId: string) => {
      const node = getNodeById(nodeId);
      return node?.data.label || "未命名";
    },
    [getNodeById],
  );

  // 检查节点是否通过筛选
  const nodePassesFilter = useCallback(
    (nodeId: string) => {
      const node = getNodeById(nodeId);
      if (!node) return false;

      if (filterColor && (node.data.color || "default") !== filterColor) {
        return false;
      }
      if (filterTag && !node.data.tags?.includes(filterTag)) {
        return false;
      }
      return true;
    },
    [getNodeById, filterColor, filterTag],
  );

  // 过滤后的群组
  const filteredGroups = useMemo(() => {
    if (!hasActiveFilter) {
      return groups;
    }

    const connected = groups.connected
      .map((group) => ({ ...group, nodeIds: group.nodeIds.filter(nodePassesFilter) }))
      .filter((group) => group.nodeIds.length > 0);

    const isolated = groups.isolated.filter(nodePassesFilter);

    return { connected, isolated };
  }, [groups, hasActiveFilter, nodePassesFilter]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 bg-primary rounded-full" />
          <span className="text-sm font-semibold text-text tracking-tight">节点大纲</span>
        </div>
        <span className="badge">{nodes.length}</span>
      </div>

      {/* 统计信息 */}
      <div className="px-4 py-2.5 border-b border-border">
        <button
          onClick={() => setShowStats(!showStats)}
          className="w-full flex items-center justify-between text-xs text-text-muted cursor-pointer hover:text-text transition-colors group"
        >
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5 group-hover:text-primary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
              <span className="font-medium">{nodes.length}</span> 节点
            </span>
            <span className="flex items-center gap-1.5 group-hover:text-primary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <span className="font-medium">{edges.length}</span> 连接
            </span>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${showStats ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* 展开的详细统计 */}
        {showStats && nodes.length > 0 && (
          <div className="mt-3 space-y-3 animate-slideInUp">
            {/* 颜色分布 */}
            {stats.usedColors.length > 0 && (
              <div>
                <div className="text-[10px] text-text-muted/70 mb-1.5 font-medium uppercase tracking-wider">颜色分布</div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.usedColors.map(([color, count]) => (
                    <button
                      key={color}
                      onClick={() => setFilterColor(filterColor === color ? null : color)}
                      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full cursor-pointer transition-all duration-150 font-medium
                        ${filterColor === color
                          ? "bg-primary text-white shadow-sm scale-105"
                          : "bg-surface hover:bg-surface-hover hover:shadow-sm"
                        }
                      `}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10"
                        style={{ backgroundColor: NODE_COLORS[color].border }}
                      />
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 标签统计 */}
            {stats.topTags.length > 0 && (
              <div>
                <div className="text-[10px] text-text-muted/70 mb-1.5 font-medium uppercase tracking-wider">
                  热门标签 <span className="text-text-muted/50">({stats.uniqueTags})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.topTags.map(([tag, count]) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                      className={`text-[11px] px-2 py-1 rounded-full cursor-pointer transition-all duration-150 font-medium
                        ${filterTag === tag
                          ? "bg-primary text-white shadow-sm"
                          : "bg-primary/10 text-primary hover:bg-primary/20"
                        }
                      `}
                    >
                      {tag} <span className="opacity-60">({count})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 筛选状态指示 */}
      {hasActiveFilter && (
        <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-gradient-to-r from-primary/10 to-transparent animate-fadeIn">
          <div className="flex items-center gap-2 text-[11px] text-primary font-medium">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>
              {filterColor && `颜色: ${filterColor}`}
              {filterColor && filterTag && " + "}
              {filterTag && `标签: ${filterTag}`}
            </span>
            <span className="badge badge-primary">
              {filteredGroups.connected.reduce((sum, g) => sum + g.nodeIds.length, 0) + filteredGroups.isolated.length}
            </span>
          </div>
          <button
            onClick={clearFilters}
            className="text-[11px] text-text-muted hover:text-primary cursor-pointer font-medium transition-colors"
          >
            清除
          </button>
        </div>
      )}

      {/* 节点列表 - 分组显示 */}
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-sm text-text-muted font-medium">暂无节点</div>
            <div className="text-xs text-text-muted/60 mt-1">双击画布创建节点</div>
          </div>
        ) : filteredGroups.connected.length === 0 && filteredGroups.isolated.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-sm text-text-muted font-medium">无匹配节点</div>
            <button
              onClick={clearFilters}
              className="text-xs text-primary cursor-pointer hover:underline mt-2 font-medium"
            >
              清除筛选
            </button>
          </div>
        ) : (
          <div className="py-1">
            {/* 连接群组 */}
            {filteredGroups.connected.map((group, groupIndex) => {
              const isExpanded = expandedGroups.has(group.id);
              return (
                <div key={group.id} className="border-b border-border/40">
                  {/* 群组标题 */}
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full px-4 py-2.5 flex items-center justify-between group-header cursor-pointer transition-all duration-150 hover:bg-surface"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-text">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform duration-200 text-text-muted ${isExpanded ? "rotate-90" : ""}`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>群组 {groupIndex + 1}</span>
                    </div>
                    <span className="badge">{group.nodeIds.length}</span>
                  </button>

                  {/* 群组内节点 */}
                  {isExpanded && (
                    <div className="bg-white animate-fadeIn">
                      {group.nodeIds.map((nodeId) => {
                        const node = getNodeById(nodeId);
                        if (!node) return null;
                        const data = node.data;
                        const colorConfig = NODE_COLORS[data.color || "default"];
                        const isSelected = nodeId === selectedNodeId;
                        const conn = connectionInfo[nodeId];
                        const isConnectionExpanded = expandedConnections.has(nodeId);

                        return (
                          <NodeRow
                            key={nodeId}
                            nodeId={nodeId}
                            data={data}
                            colorBorder={colorConfig.border}
                            isSelected={isSelected}
                            onFocusNode={handleNodeClick}
                            connection={conn}
                            isConnectionExpanded={isConnectionExpanded}
                            onToggleConnectionExpanded={toggleConnectionExpand}
                            getNodeLabel={getNodeLabel}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 未连接节点 */}
            {filteredGroups.isolated.length > 0 && (
              <div className="border-b border-border/40">
                {/* 标题 */}
                <button
                  onClick={() => toggleGroup("isolated")}
                  className="w-full px-4 py-2.5 flex items-center justify-between bg-surface/20 cursor-pointer transition-all duration-150 hover:bg-surface/40"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`transition-transform duration-200 ${expandedGroups.has("isolated") ? "rotate-90" : ""}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span>未连接</span>
                  </div>
                  <span className="badge">{filteredGroups.isolated.length}</span>
                </button>

                {/* 未连接节点列表 */}
                {expandedGroups.has("isolated") && (
                  <div className="bg-white animate-fadeIn">
                    {filteredGroups.isolated.map((nodeId) => {
                      const node = getNodeById(nodeId);
                      if (!node) return null;
                      const data = node.data;
                      const colorConfig = NODE_COLORS[data.color || "default"];
                      const isSelected = nodeId === selectedNodeId;

                      return (
                        <NodeRow
                          key={nodeId}
                          nodeId={nodeId}
                          data={data}
                          colorBorder={colorConfig.border}
                          isSelected={isSelected}
                          onFocusNode={handleNodeClick}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeOutline;
