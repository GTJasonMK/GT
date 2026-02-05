import { memo, useState, useRef, useEffect, useCallback, type FC } from "react";
import { type EdgeProps, EdgeLabelRenderer, useReactFlow } from "@xyflow/react";

/**
 * 自定义中心连接边
 * 连线从源节点中心到目标节点中心，使用贝塞尔曲线
 * 支持显示和编辑关系标签
 */
const CenterEdge: FC<EdgeProps> = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
  selected,
  label,
}) => {
  const { setEdges } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(label || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部 label 变化
  useEffect(() => {
    if (!isEditing) {
      setEditValue(String(label || ""));
    }
  }, [label, isEditing]);

  // 聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 保存编辑
  const saveEdit = useCallback(() => {
    const trimmedValue = editValue.trim();
    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === id ? { ...edge, label: trimmedValue || undefined } : edge
      )
    );
    setIsEditing(false);
  }, [id, editValue, setEdges]);

  // 处理按键
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveEdit();
      } else if (e.key === "Escape") {
        setEditValue(String(label || ""));
        setIsEditing(false);
      }
    },
    [saveEdit, label]
  );

  // 双击开始编辑
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  // 计算控制点，使曲线更自然
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // 曲线弯曲程度与距离成正比，但有上限
  const curvature = Math.min(distance * 0.3, 80);

  // 根据相对位置决定曲线方向
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // 如果是横向连接，曲线向上/下弯曲；如果是纵向连接，曲线向左/右弯曲
  const isHorizontal = Math.abs(dx) > Math.abs(dy);
  const controlX = isHorizontal ? midX : midX + (dy > 0 ? -curvature : curvature);
  const controlY = isHorizontal ? midY + (dx > 0 ? -curvature : curvature) : midY;

  // 构建贝塞尔曲线路径
  const path = `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`;

  // 计算标签位置（曲线中点）
  const labelX = (sourceX + 2 * controlX + targetX) / 4;
  const labelY = (sourceY + 2 * controlY + targetY) / 4;

  // 连线颜色（优先使用 style.stroke，否则使用默认色）
  const strokeColor = (style.stroke as string) || "#B45309";
  const selectedColor = selected ? "#92400E" : strokeColor;
  const shouldAnimate = selected;

  return (
    <>
      {/* 边路径 */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={path}
        style={{
          strokeWidth: selected ? 3 : 2,
          stroke: selectedColor,
          fill: "none",
        }}
        markerEnd={markerEnd}
      />

      {/* 点击区域（更宽，方便选中） */}
      <path
        d={path}
        style={{
          strokeWidth: 20,
          stroke: "transparent",
          fill: "none",
        }}
        className="react-flow__edge-interaction"
      />

      {/* 动画效果 - 流动的点（仅在选中时启用，避免大量边同时动画导致卡顿） */}
      {shouldAnimate && (
        <circle r="3" fill={strokeColor}>
          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
        </circle>
      )}

      {/* 边标签/编辑区域 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          onDoubleClick={handleDoubleClick}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full border-2 border-primary bg-white text-text outline-none min-w-[60px] text-center"
              placeholder="输入关系"
            />
          ) : label ? (
            <div
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full cursor-pointer transition-all duration-150
                ${selected
                  ? "bg-primary text-white shadow-md"
                  : "bg-white text-text-muted border border-border hover:border-primary-light hover:text-primary"
                }
              `}
              title="双击编辑"
            >
              {label}
            </div>
          ) : (
            <div
              className={`w-5 h-5 rounded-full cursor-pointer transition-all duration-150 flex items-center justify-center
                ${selected
                  ? "bg-primary/20 border-2 border-primary"
                  : "bg-white/80 border border-border/50 hover:border-primary-light opacity-0 hover:opacity-100"
                }
              `}
              title="双击添加标签"
            >
              <span className="text-[10px] text-text-muted">+</span>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

CenterEdge.displayName = "CenterEdge";

export default CenterEdge;
