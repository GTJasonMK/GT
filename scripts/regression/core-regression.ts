import assert from "node:assert/strict";
import { useGraphStore } from "../../src/store/graphStore";
import type { GraphData, KnowledgeNodeData } from "../../src/types";

function createNode(id: string, options?: { selected?: boolean; label?: string }) {
  const now = Date.now();
  const nodeData: KnowledgeNodeData = {
    label: options?.label ?? id,
    content: "",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  return {
    id,
    type: "knowledgeNode" as const,
    position: { x: 0, y: 0 },
    dragHandle: ".node-drag-handle",
    selected: options?.selected,
    data: nodeData,
  };
}

function resetCommonState() {
  useGraphStore.setState({
    selectedNodeId: null,
    pathFocusNodeIds: [],
    pathFocusEdgeIds: [],
    pathFocusMode: null,
    saveStatus: "idle",
    searchQuery: "",
    searchResults: [],
  });
}

function runImportExportRegression() {
  const importedData: GraphData = {
    nodes: [
      createNode("n1"),
      createNode("n2"),
      createNode("n1"),
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2", label: "关系A", data: { relation: "custom", label: "关系A" } },
      { id: "e1", source: "n1", target: "n2", label: "关系B", data: { relation: "related", label: "关系B" } },
      { id: "", source: "n1", target: "n2", label: "无效" },
    ],
  };

  useGraphStore.getState().importData(importedData);
  const state = useGraphStore.getState();

  assert.equal(state.nodes.length, 2, "重复节点应被过滤");
  assert.equal(state.edges.length, 2, "空 ID 边应被过滤，重复 ID 边应重命名");
  assert.ok(state.edges.some((edge) => edge.id === "e1__1"), "重复边应自动重命名");

  const exported = useGraphStore.getState().exportData();
  const edge = exported.edges.find((item) => item.id === "e1");
  assert.equal(edge?.data?.relation, "custom", "导出应保留边关系");
  assert.equal(edge?.label, "关系A", "导出应保留边标签");

  resetCommonState();
}

function runPathFocusRegression() {
  useGraphStore.setState({
    nodes: [createNode("A", { selected: true }), createNode("B", { selected: true })],
    edges: [{ id: "edge_ba", source: "B", target: "A", type: "centerEdge" }],
    selectedNodeId: null,
    pathFocusNodeIds: [],
    pathFocusEdgeIds: [],
    pathFocusMode: null,
    saveStatus: "idle",
    searchQuery: "",
    searchResults: [],
  });

  const result = useGraphStore.getState().focusShortestPathBetweenSelectedNodes();
  const state = useGraphStore.getState();

  assert.equal(result.ok, true, "路径聚焦应成功");
  assert.equal(state.pathFocusMode, "directed", "反向有向路径应仍判定为有向模式");
  assert.deepEqual(state.pathFocusEdgeIds, ["edge_ba"], "应聚焦正确路径边");

  resetCommonState();
}

function runBatchLockDepthRegression() {
  useGraphStore.setState({
    nodes: [createNode("lock_target", { selected: true })],
    edges: [],
    selectedNodeId: "lock_target",
    pathFocusNodeIds: [],
    pathFocusEdgeIds: [],
    pathFocusMode: null,
    saveStatus: "idle",
    searchQuery: "",
    searchResults: [],
  });

  const result = useGraphStore.getState().applyBatchEditToSelectedNodes({
    lock: {
      enabled: true,
      mode: "level",
      depth: Number.NaN,
    },
  });

  assert.equal(result.ok, true, "批量锁定应成功");
  const node = useGraphStore.getState().nodes[0];
  assert.equal(node?.data.lockDepth, 1, "无效层级应回落为最小值 1");

  resetCommonState();
}

function runEdgeLabelSyncRegression() {
  useGraphStore.setState({
    nodes: [createNode("n1"), createNode("n2")],
    edges: [
      {
        id: "edge_sync",
        source: "n1",
        target: "n2",
        type: "centerEdge",
        label: "旧标签",
        data: { relation: "custom", label: "旧标签" },
      },
    ],
    selectedNodeId: null,
    pathFocusNodeIds: [],
    pathFocusEdgeIds: [],
    pathFocusMode: null,
    saveStatus: "idle",
    searchQuery: "",
    searchResults: [],
  });

  useGraphStore.getState().updateEdgeLabel("edge_sync", " 新标签 ");
  let edge = useGraphStore.getState().edges.find((item) => item.id === "edge_sync");

  assert.equal(edge?.label, "新标签", "边标签应去除首尾空白");
  assert.equal((edge?.data as { label?: string } | undefined)?.label, "新标签", "边 data.label 应与 label 同步");

  useGraphStore.getState().updateEdgeLabel("edge_sync", "   ");
  edge = useGraphStore.getState().edges.find((item) => item.id === "edge_sync");

  assert.equal(edge?.label, undefined, "清空标签后应写入 undefined");
  assert.equal((edge?.data as { relation?: string; label?: string } | undefined)?.relation, "custom", "清空标签不应丢失 relation");
  assert.equal((edge?.data as { label?: string } | undefined)?.label, undefined, "清空标签后应移除 data.label");

  resetCommonState();
}

function main() {
  runImportExportRegression();
  runPathFocusRegression();
  runBatchLockDepthRegression();
  runEdgeLabelSyncRegression();
  console.log("[PASS] core regression checks passed");
}

main();
