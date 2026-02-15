import { EDGE_COLORS, type EdgeColor, type KnowledgeEdgeData, type NodeColor } from "@/types";

const EDGE_COLOR_MIGRATION_MAP: Record<string, EdgeColor> = {
  core: "p0",
  important: "p3",
  normal: "p5",
  minor: "p6",
};

const NODE_COLOR_VALUES: NodeColor[] = ["default", "red", "orange", "yellow", "green", "blue", "purple", "pink"];
const EDGE_RELATIONS: KnowledgeEdgeData["relation"][] = ["related", "prerequisite", "extends", "custom"];

/**
 * 标准化节点锁定层级，默认最小值为 1，可按需传入上限。
 */
export function clampLockDepth(depth: number, minDepth = 1, maxDepth?: number): number {
  const normalizedMinDepth = Number.isFinite(minDepth) ? Math.max(1, Math.floor(minDepth)) : 1;
  const normalizedDepth = Number.isFinite(depth) ? Math.floor(depth) : normalizedMinDepth;
  const minClampedDepth = Math.max(normalizedMinDepth, normalizedDepth);

  if (maxDepth === undefined || !Number.isFinite(maxDepth)) {
    return minClampedDepth;
  }

  const normalizedMaxDepth = Math.max(normalizedMinDepth, Math.floor(maxDepth));
  return Math.min(normalizedMaxDepth, minClampedDepth);
}

/**
 * 标准化标签数组：去空白、去重，保留原始顺序。
 */
export function normalizeTagList(tags: string[]): string[] {
  const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
  return Array.from(new Set(normalizedTags));
}

/**
 * 标准化节点颜色枚举值。
 */
export function normalizeNodeColor(value: unknown): NodeColor | undefined {
  if (typeof value !== "string") return undefined;
  return NODE_COLOR_VALUES.includes(value as NodeColor) ? (value as NodeColor) : undefined;
}

/**
 * 标准化边关系类型。
 */
export function normalizeEdgeRelation(value: unknown): KnowledgeEdgeData["relation"] | undefined {
  if (typeof value !== "string") return undefined;
  return EDGE_RELATIONS.includes(value as KnowledgeEdgeData["relation"])
    ? (value as KnowledgeEdgeData["relation"])
    : undefined;
}

/**
 * 标准化边数据对象，仅保留可识别字段。
 */
export function normalizeEdgeData(value: unknown): KnowledgeEdgeData | undefined {
  if (!value || typeof value !== "object") return undefined;

  const rawData = value as { relation?: unknown; label?: unknown };
  const relation = normalizeEdgeRelation(rawData.relation);
  if (!relation) return undefined;

  const label = typeof rawData.label === "string" ? rawData.label : undefined;
  if (label !== undefined) {
    return { relation, label };
  }
  return { relation };
}

/**
 * 标准化边颜色（兼容历史字段）。
 */
export function normalizeEdgeColor(value: unknown): EdgeColor {
  if (typeof value !== "string") return "default";
  if (Object.prototype.hasOwnProperty.call(EDGE_COLORS, value)) return value as EdgeColor;
  return EDGE_COLOR_MIGRATION_MAP[value] ?? "default";
}
