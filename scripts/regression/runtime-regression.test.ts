import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryExecutionTracker } from "../../src/agent/executionTracker.ts";
import { createGraphWorkspaceRuntime } from "../../src/agent/createGraphWorkspaceRuntime.ts";

function createGraphData(label: string) {
  const updatedAt = 1710000000000;
  return {
    nodes: [
      {
        id: "node_root",
        type: "knowledgeNode",
        position: { x: 120, y: 160 },
        data: { label, content: "<p>root</p>", tags: ["root"], createdAt: updatedAt, updatedAt },
      },
      {
        id: "node_child",
        type: "knowledgeNode",
        position: { x: 360, y: 240 },
        data: { label: `${label}-child`, content: "<p>child</p>", tags: ["child"], createdAt: updatedAt, updatedAt },
      },
    ],
    edges: [
      {
        id: "edge_root_child",
        source: "node_root",
        target: "node_child",
        label: "extends",
      },
    ],
  };
}

test("workspace snapshot preserves selected node ids", () => {
  const graph = createGraphData("workspace-alpha");
  const runtime = createGraphWorkspaceRuntime({
    tracker: createInMemoryExecutionTracker(() => Date.now()),
    getWorkspaceReadModel: () => ({
      allData: graph,
      selectedData: { nodes: graph.nodes, edges: [] },
      selectedNodeCount: 2,
      selectedNodeId: "node_root",
      selectedNodeIds: ["node_root", "node_child"],
      saveStatus: "idle" as const,
    }),
    saveWorkspace: async () => {},
    replaceWorkspace: () => {},
    exportWorkspaceJson: async () => {},
    describePersistenceTarget: async () => ({
      backend: "local_storage" as const,
      location: "graph_data",
      exists: true,
      byteSize: 1,
      updatedAt: 1,
    }),
  });

  const snapshot = runtime.queries.getWorkspaceSnapshot();

  assert.equal(snapshot.selectedNodeId, "node_root");
  assert.deepEqual(snapshot.selectedNodeIds, ["node_root", "node_child"]);
});

test("approve workspace export forwards explicit outputPath to exporter", async () => {
  const graph = createGraphData("workspace-alpha");
  const exportCalls: unknown[] = [];
  const runtime = createGraphWorkspaceRuntime({
    tracker: createInMemoryExecutionTracker(() => Date.now()),
    getWorkspaceReadModel: () => ({
      allData: graph,
      selectedData: { nodes: [graph.nodes[0]], edges: [] },
      selectedNodeCount: 1,
      selectedNodeId: "node_root",
      selectedNodeIds: ["node_root"],
      saveStatus: "idle" as const,
    }),
    saveWorkspace: async () => {},
    replaceWorkspace: () => {},
    exportWorkspaceJson: async (...args) => {
      exportCalls.push(args);
    },
    describePersistenceTarget: async () => ({
      backend: "local_storage" as const,
      location: "graph_data",
      exists: true,
      byteSize: 1,
      updatedAt: 1,
    }),
  });

  const request = await runtime.actions.requestWorkspaceJsonExport({
    actor: "human",
    scope: "selected",
    filename: "selected.json",
  });
  assert.equal(request.error?.code, "APPROVAL_REQUIRED");

  const approved = await runtime.actions.approveWorkspaceExport({
    approvalId: request.approval!.id,
    actor: "human",
    outputPath: "/tmp/selected-export.json",
  });

  assert.equal(approved.ok, true);
  assert.deepEqual(exportCalls, [
    [
      { nodes: [graph.nodes[0]], edges: [] },
      { filename: "selected.json", outputPath: "/tmp/selected-export.json" },
    ],
  ]);
});
