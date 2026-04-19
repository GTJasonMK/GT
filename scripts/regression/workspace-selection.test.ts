import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkspaceSnapshotSelection } from "../../src/agent/workspaceSelection.ts";

test("bridge selection replay keeps multi-selection instead of collapsing to primary node", () => {
  const nodes = [
    { id: "node_root", selected: false, data: { label: "root" } },
    { id: "node_child", selected: false, data: { label: "child" } },
    { id: "node_other", selected: true, data: { label: "other" } },
  ];

  const nextState = applyWorkspaceSnapshotSelection(nodes, {
    selectedNodeId: "node_root",
    selectedNodeIds: ["node_root", "node_child"],
  });

  assert.equal(nextState.selectedNodeId, "node_root");
  assert.deepEqual(nextState.selectedNodeIds, ["node_root", "node_child"]);
  assert.equal(nextState.nodes.find((node) => node.id === "node_root")?.selected, true);
  assert.equal(nextState.nodes.find((node) => node.id === "node_child")?.selected, true);
  assert.equal(nextState.nodes.find((node) => node.id === "node_other")?.selected, false);
});
