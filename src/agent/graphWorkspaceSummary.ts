import type { GraphData } from "../types/index.ts";
import type { GraphWorkspaceSummary } from "./types.ts";

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function computeGraphRevision(data: GraphData): string {
  const nodeToken = data.nodes
    .map((node) => `${node.id}:${node.data.updatedAt}:${node.position.x}:${node.position.y}`)
    .sort()
    .join("|");
  const edgeToken = data.edges
    .map((edge) => `${edge.id}:${edge.source}:${edge.target}:${edge.label ?? ""}`)
    .sort()
    .join("|");

  return `rev_${data.nodes.length}_${data.edges.length}_${hashString(`${nodeToken}#${edgeToken}`)}`;
}

export function buildWorkspaceSummary(args: {
  data: GraphData;
  selectedNodeCount: number;
  saveStatus: GraphWorkspaceSummary["saveStatus"];
}): GraphWorkspaceSummary {
  const lastUpdatedAt = args.data.nodes.reduce<number | null>((latest, node) => {
    if (typeof node.data.updatedAt !== "number") return latest;
    if (latest === null || node.data.updatedAt > latest) return node.data.updatedAt;
    return latest;
  }, null);

  return {
    resourceId: "graph_workspace:active",
    revision: computeGraphRevision(args.data),
    nodeCount: args.data.nodes.length,
    edgeCount: args.data.edges.length,
    selectedNodeCount: args.selectedNodeCount,
    saveStatus: args.saveStatus,
    hasContent: args.data.nodes.length > 0 || args.data.edges.length > 0,
    lastUpdatedAt,
  };
}
