export interface WorkspaceSelectionSnapshot {
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface SelectableNodeLike {
  id: string;
  selected?: boolean;
}

function dedupeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
}

export function normalizeWorkspaceSelection(
  snapshot: WorkspaceSelectionSnapshot,
  validNodeIds: Iterable<string>,
): WorkspaceSelectionSnapshot {
  const validNodeIdSet = new Set(validNodeIds);
  const selectedNodeIds = dedupeIds(snapshot.selectedNodeIds).filter((id) => validNodeIdSet.has(id));
  const primaryNodeId = snapshot.selectedNodeId && validNodeIdSet.has(snapshot.selectedNodeId)
    ? snapshot.selectedNodeId
    : null;

  if (primaryNodeId && !selectedNodeIds.includes(primaryNodeId)) {
    selectedNodeIds.unshift(primaryNodeId);
  }

  return {
    selectedNodeId: primaryNodeId ?? selectedNodeIds[0] ?? null,
    selectedNodeIds,
  };
}

export function applyWorkspaceSnapshotSelection<TNode extends SelectableNodeLike>(
  nodes: readonly TNode[],
  snapshot: WorkspaceSelectionSnapshot,
) {
  const normalizedSelection = normalizeWorkspaceSelection(
    snapshot,
    nodes.map((node) => node.id),
  );
  const selectedNodeIdSet = new Set(normalizedSelection.selectedNodeIds);

  return {
    ...normalizedSelection,
    nodes: nodes.map((node) => {
      const nextSelected = selectedNodeIdSet.has(node.id);
      if (Boolean(node.selected) === nextSelected) return node;
      return { ...node, selected: nextSelected };
    }),
  };
}
