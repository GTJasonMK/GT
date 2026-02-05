// 节点颜色类型
export type NodeColor = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";

// 节点颜色配置
export const NODE_COLORS: Record<NodeColor, { bg: string; border: string; text: string }> = {
  default: { bg: "#FDFBF8", border: "#DDD5CB", text: "#3D3329" },
  red: { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B" },
  orange: { bg: "#FFF7ED", border: "#FDBA74", text: "#9A3412" },
  yellow: { bg: "#FEFCE8", border: "#FDE047", text: "#854D0E" },
  green: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534" },
  blue: { bg: "#EFF6FF", border: "#93C5FD", text: "#1E40AF" },
  purple: { bg: "#FAF5FF", border: "#C4B5FD", text: "#6B21A8" },
  pink: { bg: "#FDF2F8", border: "#F9A8D4", text: "#9D174D" },
};

// 连线颜色类型（表示节点重要程度）
export const EDGE_IMPORTANCE_RANKS = [
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
  "p8",
  "p9",
] as const;

export type EdgeImportance = (typeof EDGE_IMPORTANCE_RANKS)[number];
export type EdgeColor = "default" | EdgeImportance;

// 连线颜色配置
export const EDGE_COLORS: Record<EdgeColor, { stroke: string; label: string; description: string }> = {
  default: { stroke: "#64748B", label: "默认", description: "未设置重要度" },
  p0: { stroke: "#DC2626", label: "P0 核心", description: "核心知识点" },
  p1: { stroke: "#F97316", label: "P1 极重要", description: "非常关键的知识点" },
  p2: { stroke: "#F59E0B", label: "P2 很重要", description: "较关键的知识点" },
  p3: { stroke: "#EAB308", label: "P3 重要", description: "重要知识点" },
  p4: { stroke: "#84CC16", label: "P4 较重要", description: "较重要知识点" },
  p5: { stroke: "#22C55E", label: "P5 一般", description: "一般知识点" },
  p6: { stroke: "#10B981", label: "P6 次要", description: "次要知识点" },
  p7: { stroke: "#06B6D4", label: "P7 延伸", description: "延伸/补充知识点" },
  p8: { stroke: "#3B82F6", label: "P8 参考", description: "参考信息/旁支内容" },
  p9: { stroke: "#8B5CF6", label: "P9 可忽略", description: "低优先级内容" },
};

export const EDGE_COLOR_OPTIONS: EdgeColor[] = ["default", ...EDGE_IMPORTANCE_RANKS];

// 知识节点数据类型
// 锁定模式类型
export type LockMode = "direct" | "transitive";

export interface KnowledgeNodeData {
  label: string;
  content: string; // TipTap HTML 内容（editor.getHTML()）
  tags: string[];
  color?: NodeColor;
  edgeColor?: EdgeColor; // 该节点发出的连线颜色（重要程度）
  locked?: boolean; // 锁定模式：拖动时子节点一起移动
  lockMode?: LockMode; // 锁定范围：direct=仅直接子节点，transitive=所有可达子节点
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown; // 允许索引签名
}

// 节点关系（边）标签类型
export type EdgeRelation = "related" | "prerequisite" | "extends" | "custom";

// 边数据类型
export interface KnowledgeEdgeData {
  relation: EdgeRelation;
  label?: string;
}

// 持久化数据格式
export interface GraphData {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: KnowledgeNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    data?: KnowledgeEdgeData;
    label?: string;
  }>;
}
