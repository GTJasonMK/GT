import type { GraphData, KnowledgeNodeData } from "@/types";

interface ParseTextToGraphOptions {
  sourceLabel?: string;
}

function createNodeId(index: number) {
  return `node_text_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeLine(line: string): string {
  return line
    .replace(/^[-*•\d+.)\s]+/, "")
    .replace(/[：:]+/g, ":")
    .trim();
}

function splitToConcepts(text: string): string[] {
  const rawLines = text.split(/\r?\n/).map((line) => normalizeLine(line)).filter(Boolean);
  if (rawLines.length > 1) {
    return Array.from(new Set(rawLines)).slice(0, 80);
  }

  const tokens = text
    .split(/[，,。；;、\n]/)
    .map((line) => normalizeLine(line))
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 80);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseTextToGraph(text: string, options?: ParseTextToGraphOptions): GraphData | null {
  const concepts = splitToConcepts(text);
  if (concepts.length === 0) return null;

  const sourceLabel = options?.sourceLabel?.trim() || "文本主题";
  const now = Date.now();
  const centerId = createNodeId(0);

  const centerData: KnowledgeNodeData = {
    label: sourceLabel,
    content: `<p>${escapeHtml(sourceLabel)}</p>`,
    tags: ["AI生成"],
    createdAt: now,
    updatedAt: now,
  };

  const nodes: GraphData["nodes"] = [
    {
      id: centerId,
      type: "knowledgeNode",
      position: { x: 200, y: 200 },
      data: centerData,
    },
  ];

  const edges: GraphData["edges"] = [];
  const radius = 220;
  const count = Math.max(1, concepts.length);

  concepts.forEach((concept, index) => {
    const nodeId = createNodeId(index + 1);
    const angle = (Math.PI * 2 * index) / count;
    const x = 200 + Math.cos(angle) * radius;
    const y = 200 + Math.sin(angle) * radius;

    const data: KnowledgeNodeData = {
      label: concept.slice(0, 36),
      content: `<p>${escapeHtml(concept)}</p>`,
      tags: ["AI生成"],
      createdAt: now,
      updatedAt: now,
    };

    nodes.push({
      id: nodeId,
      type: "knowledgeNode",
      position: { x, y },
      data,
    });

    edges.push({
      id: `edge_text_${centerId}_${nodeId}`,
      source: centerId,
      target: nodeId,
      label: "包含",
    });
  });

  return { nodes, edges };
}
