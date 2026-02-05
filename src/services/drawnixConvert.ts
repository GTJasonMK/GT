import type { GraphData, KnowledgeNodeData } from "@/types";
import { NODE_CENTER_OFFSET } from "@/constants/graphLayout";

interface DrawnixExportedDataLike {
  type: string;
  version?: number;
  source?: string;
  elements?: unknown[];
  viewport?: unknown;
}

interface ConvertOptions {
  /**
   * 是否转换自由绘制的形状（geometry）为节点
   */
  includeGeometry?: boolean;
  /**
   * 是否转换箭头连线（arrow-line）为边
   */
  includeArrowLines?: boolean;
  /**
   * 当 arrow-line 未绑定 target/source 时，用于“就近吸附”节点的最大距离（像素）
   */
  arrowSnapDistance?: number;
  /**
   * mind/mindmap 的水平间距（按层级）
   */
  mindHorizontalGap?: number;
  /**
   * mind/mindmap 的垂直间距（按叶子）
   */
  mindVerticalGap?: number;
}

export interface ConvertReport {
  nodes: number;
  edges: number;
  warnings: string[];
}

function isDrawnixExportedDataLike(value: unknown): value is DrawnixExportedDataLike {
  if (!value || typeof value !== "object") return false;
  const v = value as DrawnixExportedDataLike;
  return v.type === "drawnix" && Array.isArray(v.elements);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSimpleHtmlParagraph(text: string): string {
  const safe = escapeHtml(text.trim());
  if (!safe) return "";
  return `<p>${safe}</p>`;
}

/**
 * Drawnix 使用 Slate 风格的富文本结构，这里提取纯文本用于 label/content。
 */
function extractPlainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join("");
  }
  if (typeof node === "object") {
    const n = node as { text?: unknown; children?: unknown[]; type?: unknown };
    if (typeof n.text === "string") return n.text;
    if (Array.isArray(n.children)) {
      const childText = n.children.map(extractPlainText).join("");
      // 常见段落结构：顶层可能是多个 paragraph，这里用换行分隔更接近原意
      if (n.type === "paragraph") return `${childText}\n`;
      return childText;
    }
  }
  return "";
}

function normalizeLabel(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  // Slate paragraph 提取时会额外拼接 '\n'，这里收敛一下
  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

function toNodeId(drawnixId: string): string {
  return `dx_${drawnixId}`;
}

type Point = [number, number];

function getPoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points: Point[] = [];
  value.forEach((p) => {
    if (!Array.isArray(p) || p.length < 2) return;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  });
  return points.length > 0 ? points : null;
}

function getBBoxCenter(points: Point[]): Point {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

interface MindNode {
  id: string;
  label: string;
  children: MindNode[];
  depth: number;
  x: number;
  y: number;
}

function buildMindTree(raw: any, depth: number): MindNode {
  const topic = raw?.data?.topic;
  const label = normalizeLabel(extractPlainText(topic));
  const childrenRaw = Array.isArray(raw?.children) ? raw.children : [];
  const children = childrenRaw.map((c: any) => buildMindTree(c, depth + 1));
  return {
    id: String(raw?.id ?? ""),
    label,
    children,
    depth,
    x: 0,
    y: 0,
  };
}

function assignMindY(node: MindNode, yCursor: number, verticalGap: number): number {
  if (node.children.length === 0) {
    node.y = yCursor;
    return yCursor + verticalGap;
  }

  node.children.forEach((c) => {
    yCursor = assignMindY(c, yCursor, verticalGap);
  });

  node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
  return yCursor;
}

function walkMind(node: MindNode, fn: (n: MindNode) => void) {
  fn(node);
  node.children.forEach((c) => walkMind(c, fn));
}

function findNearestNodeId(
  candidates: Array<{ id: string; center: Point }>,
  point: Point,
  maxDistance: number,
): string | null {
  const maxD2 = maxDistance * maxDistance;
  let bestId: string | null = null;
  let bestD2 = Infinity;
  candidates.forEach((c) => {
    const dx = c.center[0] - point[0];
    const dy = c.center[1] - point[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestId = c.id;
    }
  });
  if (bestId && bestD2 <= maxD2) return bestId;
  return null;
}

/**
 * 将 Drawnix 的 `.drawnix`（PlaitElement[]）转换为本项目的 GraphData。
 * - mind/mindmap：按树结构生成节点 + 父子边，并做一个简单的树状布局
 * - geometry：作为普通节点导入（默认开启）
 * - arrow-line：尽量按 boundId 或就近吸附生成边（默认开启）
 */
export function convertDrawnixToGraphData(
  input: unknown,
  options: ConvertOptions = {},
): { graph: GraphData; report: ConvertReport } | null {
  if (!isDrawnixExportedDataLike(input)) return null;

  const {
    includeGeometry = true,
    includeArrowLines = true,
    arrowSnapDistance = 200,
    mindHorizontalGap = 260,
    mindVerticalGap = 120,
  } = options;

  const now = Date.now();
  const warnings: string[] = [];

  const nodes: GraphData["nodes"] = [];
  const edges: GraphData["edges"] = [];

  const nodeById = new Map<string, GraphData["nodes"][number]>();

  const addNode = (node: GraphData["nodes"][number], center: Point) => {
    if (nodeById.has(node.id)) return;
    nodeById.set(node.id, node);
    nodes.push(node);
    nodeCenters.push({ id: node.id, center });
  };

  const nodeCenters: Array<{ id: string; center: Point }> = [];

  // 1) 先处理节点（mind/mindmap/geometry）
  (input.elements ?? []).forEach((elRaw) => {
    const el = elRaw as any;
    const type = String(el?.type ?? "");
    const id = String(el?.id ?? "");

    if (!id) return;

    if (type === "mind" || type === "mindmap") {
      const rootPoints = getPoints(el?.points);
      if (!rootPoints) {
        warnings.push(`mind/mindmap 缺少 points，已跳过：${id}`);
        return;
      }

      const rootCenter: Point = rootPoints[0];
      const tree = buildMindTree(el, 0);
      if (!tree.id) {
        warnings.push(`mind/mindmap 根节点缺少 id，已跳过`);
        return;
      }

      // 计算纵向布局（先在 y=0 起步，然后整体平移到 rootCenter.y）
      assignMindY(tree, 0, mindVerticalGap);
      const deltaY = rootCenter[1] - tree.y;

      const layout = String(el?.layout ?? "right");
      const direction = layout === "left" ? -1 : 1;

      walkMind(tree, (n) => {
        n.x = rootCenter[0] + direction * n.depth * mindHorizontalGap;
        n.y = n.y + deltaY;

        const nodeId = toNodeId(n.id);
        const label = n.label || "未命名";
        const data: KnowledgeNodeData = {
          label,
          content: toSimpleHtmlParagraph(label),
          tags: [],
          createdAt: now,
          updatedAt: now,
        };

        addNode(
          {
            id: nodeId,
            type: "knowledgeNode",
            position: {
              x: n.x - NODE_CENTER_OFFSET.x,
              y: n.y - NODE_CENTER_OFFSET.y,
            },
            data,
          },
          [n.x, n.y],
        );
      });

      // mind 边：父子关系
      const addMindEdges = (parent: MindNode) => {
        parent.children.forEach((child) => {
          const source = toNodeId(parent.id);
          const target = toNodeId(child.id);
          edges.push({
            id: `dx_mind_${parent.id}_${child.id}`,
            source,
            target,
          });
          addMindEdges(child);
        });
      };
      addMindEdges(tree);
      return;
    }

    if (includeGeometry && type === "geometry") {
      const pts = getPoints(el?.points);
      if (!pts) {
        warnings.push(`geometry 缺少 points，已跳过：${id}`);
        return;
      }
      const center = getBBoxCenter(pts);
      const text = normalizeLabel(extractPlainText(el?.text));
      const label = text || "未命名";

      addNode(
        {
          id: toNodeId(id),
          type: "knowledgeNode",
          position: {
            x: center[0] - NODE_CENTER_OFFSET.x,
            y: center[1] - NODE_CENTER_OFFSET.y,
          },
          data: {
            label,
            content: toSimpleHtmlParagraph(label),
            tags: ["drawnix:geometry"],
            createdAt: now,
            updatedAt: now,
          },
        },
        center,
      );
      return;
    }
  });

  // 2) 再处理 arrow-line（需要 nodeCenters）
  if (includeArrowLines) {
    (input.elements ?? []).forEach((elRaw) => {
      const el = elRaw as any;
      const type = String(el?.type ?? "");
      if (type !== "arrow-line") return;

      const id = String(el?.id ?? "");
      const pts = getPoints(el?.points);
      if (!id || !pts || pts.length < 2) {
        warnings.push(`arrow-line 数据不完整，已跳过：${id || "(unknown)"}`);
        return;
      }

      const start = pts[0];
      const end = pts[pts.length - 1];

      const sourceBoundId = el?.source?.boundId ? toNodeId(String(el.source.boundId)) : null;
      const targetBoundId = el?.target?.boundId ? toNodeId(String(el.target.boundId)) : null;

      const sourceId =
        sourceBoundId ??
        findNearestNodeId(nodeCenters, start, arrowSnapDistance);
      const targetId =
        targetBoundId ??
        findNearestNodeId(nodeCenters, end, arrowSnapDistance);

      if (!sourceId || !targetId) {
        warnings.push(`arrow-line 无法解析端点绑定，已跳过：${id}`);
        return;
      }
      if (sourceId === targetId) {
        warnings.push(`arrow-line 源/目标相同，已跳过：${id}`);
        return;
      }

      const labelText = normalizeLabel(extractPlainText(el?.texts));
      edges.push({
        id: `dx_arrow_${id}`,
        source: sourceId,
        target: targetId,
        label: labelText || undefined,
      });
    });
  }

  return {
    graph: { nodes, edges },
    report: { nodes: nodes.length, edges: edges.length, warnings },
  };
}
