import type { FC } from "react";
import type { KnowledgeNodeData } from "@/types";
import type { ConnectionInfo } from "@/lib/nodeOutline";

// 关系类型的中文标签
const RELATION_LABELS: Record<string, string> = {
  related: "相关",
  prerequisite: "前置",
  extends: "扩展",
  custom: "自定义",
};

interface NodeRowProps {
  nodeId: string;
  data: KnowledgeNodeData;
  colorBorder: string;
  isSelected: boolean;

  onFocusNode: (nodeId: string) => void;

  connection?: ConnectionInfo;
  isConnectionExpanded?: boolean;
  onToggleConnectionExpanded?: (nodeId: string) => void;
  getNodeLabel?: (nodeId: string) => string;
}

/**
 * 节点行（用于大纲列表）
 * - 支持显示颜色、标题、标签
 * - 可选显示连接指示与连接详情（包含边的标签和关系类型）
 */
const NodeRow: FC<NodeRowProps> = ({
  nodeId,
  data,
  colorBorder,
  isSelected,
  onFocusNode,
  connection,
  isConnectionExpanded,
  onToggleConnectionExpanded,
  getNodeLabel,
}) => {
  const hasConnections = !!connection && (connection.outgoing.length > 0 || connection.incoming.length > 0);

  return (
    <div className={`${isSelected ? "bg-primary/10" : "hover:bg-surface"} transition-colors duration-100`}>
      <div className="flex items-start gap-2 px-3 py-2">
        {/* 颜色指示器 */}
        <div
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: colorBorder }}
        />

        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => onFocusNode(nodeId)}
              className={`text-sm truncate text-left cursor-pointer hover:text-primary transition-colors flex-1 ${
                isSelected ? "text-primary font-medium" : "text-text"
              }`}
            >
              {data.label || "未命名"}
            </button>

            {/* 连接指示器 */}
            {hasConnections && onToggleConnectionExpanded && (
              <button
                onClick={() => onToggleConnectionExpanded(nodeId)}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-primary cursor-pointer shrink-0 transition-colors"
                title="点击查看连接详情"
              >
                {connection.outgoing.length > 0 && (
                  <span className="flex items-center">
                    <span className="text-primary">→</span>
                    {connection.outgoing.length}
                  </span>
                )}
                {connection.incoming.length > 0 && (
                  <span className="flex items-center">
                    <span className="text-orange-500">←</span>
                    {connection.incoming.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* 标签 */}
          {data.tags && data.tags.length > 0 && (
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {data.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1 py-0.5 bg-surface text-text-muted rounded"
                >
                  {tag}
                </span>
              ))}
              {data.tags.length > 2 && (
                <span className="text-[10px] text-text-muted">
                  +{data.tags.length - 2}
                </span>
              )}
            </div>
          )}

          {/* 展开的连接详情 */}
          {isConnectionExpanded && hasConnections && getNodeLabel && (
            <div className="mt-1.5 pl-2 border-l-2 border-primary/20 space-y-1.5">
              {connection.outgoing.length > 0 && (
                <div className="text-[10px]">
                  <span className="text-primary font-medium">连接到:</span>
                  <div className="mt-0.5 space-y-0.5">
                    {connection.outgoing.map((edge) => (
                      <div key={edge.edgeId} className="flex items-center gap-1 pl-2">
                        <span className="text-primary">→</span>
                        <button
                          onClick={() => onFocusNode(edge.nodeId)}
                          className="text-text-muted hover:text-primary cursor-pointer hover:underline"
                        >
                          {getNodeLabel(edge.nodeId)}
                        </button>
                        {(edge.label || edge.relation) && (
                          <span className="text-text-muted/60">
                            ({edge.label || (edge.relation && RELATION_LABELS[edge.relation]) || ""})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {connection.incoming.length > 0 && (
                <div className="text-[10px]">
                  <span className="text-orange-500 font-medium">来自:</span>
                  <div className="mt-0.5 space-y-0.5">
                    {connection.incoming.map((edge) => (
                      <div key={edge.edgeId} className="flex items-center gap-1 pl-2">
                        <span className="text-orange-500">←</span>
                        <button
                          onClick={() => onFocusNode(edge.nodeId)}
                          className="text-text-muted hover:text-primary cursor-pointer hover:underline"
                        >
                          {getNodeLabel(edge.nodeId)}
                        </button>
                        {(edge.label || edge.relation) && (
                          <span className="text-text-muted/60">
                            ({edge.label || (edge.relation && RELATION_LABELS[edge.relation]) || ""})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeRow;
