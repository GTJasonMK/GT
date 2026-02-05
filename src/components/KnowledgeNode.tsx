import { memo, useState, type FC } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { KnowledgeNodeData } from "@/types";
import { NODE_COLORS } from "@/types";
import { useGraphStore } from "@/store/graphStore";

/**
 * 自定义知识节点组件
 * - 拖拽节点内容区域：移动节点
 * - 拖拽中心连接点：创建连接
 * - 支持颜色分类
 */
type KnowledgeGraphNode = Node<KnowledgeNodeData, "knowledgeNode">;

const KnowledgeNode: FC<NodeProps<KnowledgeGraphNode>> = memo(({ id, data, selected }) => {
  const [isHovered, setIsHovered] = useState(false);
  const nodeData = data;
  const searchResults = useGraphStore((s) => s.searchResults);
  const isSearchMatch = searchResults.includes(id);

  // 获取节点颜色配置
  const colorConfig = NODE_COLORS[nodeData.color || "default"];

  // 计算边框颜色
  const getBorderStyle = () => {
    if (selected) {
      return { borderColor: "#B45309", boxShadow: "0 0 0 3px rgba(180,83,9,0.15)" };
    }
    if (isSearchMatch) {
      return { borderColor: "#F97316", boxShadow: "0 0 0 3px rgba(249,115,22,0.2)" };
    }
    return { borderColor: colorConfig.border };
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 节点内容 - 拖动区域 */}
      <div
        className="node-drag-handle px-4 py-3 rounded-lg border-2 min-w-[120px] max-w-[200px] transition-all duration-200 cursor-grab active:cursor-grabbing hover:shadow-md"
        style={{
          backgroundColor: colorConfig.bg,
          ...getBorderStyle(),
        }}
      >
        {/* 节点标题 */}
        <div
          className="font-semibold text-sm truncate text-center select-none"
          style={{ color: colorConfig.text }}
        >
          {nodeData.label || "未命名"}
        </div>

        {/* 标签 */}
        {nodeData.tags && nodeData.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 justify-center">
            {nodeData.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-md font-medium select-none"
                style={{
                  backgroundColor: `${colorConfig.border}40`,
                  color: colorConfig.text,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 颜色指示器（非默认颜色时显示） */}
        {nodeData.color && nodeData.color !== "default" && (
          <div
            className="absolute top-1 right-1 w-2 h-2 rounded-full"
            style={{ backgroundColor: colorConfig.border }}
          />
        )}

        {/* 锁定指示器 */}
        {nodeData.locked && (
          <div
            className="absolute top-1 left-1 w-4 h-4 flex items-center justify-center text-primary"
            title={`已锁定：${nodeData.lockMode === "transitive" ? "所有子节点" : "直接子节点"}一起移动`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        )}
      </div>

      {/* 中心连接点 - 悬停时显示 */}
      <div
        className={`
          absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-8 h-8 rounded-full
          flex items-center justify-center
          transition-all duration-150
          ${isHovered
            ? "opacity-100 scale-100 bg-primary/30 border-2 border-primary"
            : "opacity-0 scale-50"
          }
        `}
      >
        <div className={`w-3 h-3 rounded-full bg-primary ${isHovered ? "animate-pulse" : ""}`} />

        {/* Handle放在这个div内部，确保事件能正确传递 */}
        <Handle
          type="source"
          position={Position.Right}
          id="center"
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            top: 0,
            left: 0,
            transform: 'none',
            background: 'transparent',
            border: 'none',
            borderRadius: '50%',
            cursor: 'crosshair',
          }}
        />
      </div>
    </div>
  );
});

KnowledgeNode.displayName = "KnowledgeNode";

export default KnowledgeNode;
