import type { GraphNode } from "@/store/graphStore";

export function resolveNextSelectedNodeId(nodes: GraphNode[], currentSelectedNodeId: string | null): string | null {
  const selectedIds = nodes.filter((node) => Boolean(node.selected)).map((node) => node.id);
  if (selectedIds.length === 0) return null;
  if (selectedIds.length === 1) return selectedIds[0] ?? null;
  if (currentSelectedNodeId && selectedIds.includes(currentSelectedNodeId)) {
    return currentSelectedNodeId;
  }
  return selectedIds[0] ?? null;
}

export function resolveSelectedNodeIds(nodes: GraphNode[], selectedNodeId: string | null): string[] {
  const multiSelectedIds = nodes.filter((node) => Boolean(node.selected)).map((node) => node.id);
  if (multiSelectedIds.length > 0) return multiSelectedIds;
  if (!selectedNodeId) return [];
  return nodes.some((node) => node.id === selectedNodeId) ? [selectedNodeId] : [];
}

export function prunePathFocusState(args: {
  pathFocusNodeIds: string[];
  pathFocusEdgeIds: string[];
  pathFocusMode: "directed" | "undirected" | null;
  validNodeIds: Set<string>;
  validEdgeIds: Set<string>;
}) {
  const nextPathFocusNodeIds = args.pathFocusNodeIds.filter((id) => args.validNodeIds.has(id));
  const nextPathFocusEdgeIds = args.pathFocusEdgeIds.filter((id) => args.validEdgeIds.has(id));

  if (nextPathFocusNodeIds.length < 2 || nextPathFocusEdgeIds.length === 0) {
    return { pathFocusNodeIds: [], pathFocusEdgeIds: [], pathFocusMode: null };
  }

  return {
    pathFocusNodeIds: nextPathFocusNodeIds,
    pathFocusEdgeIds: nextPathFocusEdgeIds,
    pathFocusMode: args.pathFocusMode,
  };
}

export function recomputeSearchResults(nodes: GraphNode[], query: string): string[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  return nodes
    .filter((node) => {
      const labelMatch = node.data.label?.toLowerCase().includes(normalizedQuery);
      const tagMatch = node.data.tags?.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      const contentMatch = node.data.content?.toLowerCase().includes(normalizedQuery);
      return labelMatch || tagMatch || contentMatch;
    })
    .map((node) => node.id);
}
