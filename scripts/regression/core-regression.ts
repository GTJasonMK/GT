import assert from "node:assert/strict";
import { createInMemoryExecutionTracker } from "../../src/agent/executionTracker.ts";
import { createGraphWorkspaceRuntime } from "../../src/agent/createGraphWorkspaceRuntime.ts";
import type { GraphData } from "../../src/types/index.ts";

function createGraphData(label: string, updatedAt = 1710000000000): GraphData {
  return {
    nodes: [
      {
        id: "node_root",
        type: "knowledgeNode",
        position: { x: 120, y: 160 },
        data: {
          label,
          content: "<p>root</p>",
          tags: ["root"],
          createdAt: updatedAt,
          updatedAt,
        },
      },
      {
        id: "node_child",
        type: "knowledgeNode",
        position: { x: 360, y: 240 },
        data: {
          label: `${label}-child`,
          content: "<p>child</p>",
          tags: ["child"],
          createdAt: updatedAt,
          updatedAt,
        },
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

async function main() {
  let workspace = createGraphData("workspace-alpha");
  let persistedRevisionCount = 0;
  let exportedSnapshots: Array<{ filename?: string; nodeCount: number }> = [];

  const tracker = createInMemoryExecutionTracker(() => Date.now());
  const runtime = createGraphWorkspaceRuntime({
    tracker,
    getWorkspaceReadModel: () => ({
      allData: workspace,
      selectedData: {
        nodes: [workspace.nodes[0]!],
        edges: [],
      },
      selectedNodeCount: 1,
      saveStatus: "idle",
    }),
    saveWorkspace: async () => {
      persistedRevisionCount += 1;
    },
    replaceWorkspace: (data) => {
      workspace = data;
    },
    exportWorkspaceJson: async (data, filename) => {
      exportedSnapshots.push({
        filename,
        nodeCount: data.nodes.length,
      });
    },
    describePersistenceTarget: async () => ({
      backend: "local_storage",
      location: "graph_data",
      exists: true,
      byteSize: 512,
      updatedAt: 1710000001234,
    }),
  });

  const workspaceSummary = runtime.queries.describeActiveWorkspace();
  assert.equal(workspaceSummary.nodeCount, 2, "应能读取当前工作区摘要");
  assert.ok(workspaceSummary.revision.startsWith("rev_"), "应生成稳定 revision");

  const saveResult = await runtime.actions.saveWorkspace({
    actor: "agent",
    reason: "regression-save",
  });
  assert.equal(saveResult.ok, true, "保存动作应成功");
  assert.equal(persistedRevisionCount, 1, "保存动作应真正调用持久化适配器");

  const requestExportResult = await runtime.actions.requestWorkspaceJsonExport({
    actor: "agent",
    scope: "all",
    reason: "regression-export",
  });
  assert.equal(requestExportResult.ok, false, "高风险导出应先返回审批要求");
  assert.equal(requestExportResult.error?.code, "APPROVAL_REQUIRED");
  assert.ok(requestExportResult.approval?.id, "应创建审批记录");

  const approveExportResult = await runtime.actions.approveWorkspaceExport({
    approvalId: requestExportResult.approval!.id,
    actor: "supervisor",
  });
  assert.equal(approveExportResult.ok, true, "审批通过后应执行导出");
  assert.equal(exportedSnapshots.length, 1, "导出适配器应被调用一次");
  assert.equal(exportedSnapshots[0]?.nodeCount, 2, "全图导出应包含全部节点");

  const importResult = runtime.actions.applyImportedWorkspace({
    actor: "human",
    envelope: {
      graph: createGraphData("workspace-beta", 1710000009999),
      source: "regression_import",
      warnings: [],
    },
    replaceExisting: true,
  });
  assert.equal(importResult.ok, true, "导入动作应允许替换当前工作区");
  assert.equal(runtime.queries.describeActiveWorkspace().nodeCount, 2, "导入后工作区应已更新");

  const concurrencyRequest = await runtime.actions.requestWorkspaceJsonExport({
    actor: "agent",
    scope: "all",
    reason: "concurrency-check",
  });
  assert.equal(concurrencyRequest.error?.code, "APPROVAL_REQUIRED");

  workspace = createGraphData("workspace-gamma", 1710000018888);
  const concurrencyApprove = await runtime.actions.approveWorkspaceExport({
    approvalId: concurrencyRequest.approval!.id,
    actor: "supervisor",
  });
  assert.equal(concurrencyApprove.ok, false, "revision 变化后审批应失败");
  assert.equal(concurrencyApprove.error?.code, "CONCURRENCY_CONFLICT");

  const contract = runtime.queries.getMcpContract();
  assert.ok(contract.tools.some((tool) => tool.name === "request_json_export"));
  assert.ok(contract.tools.some((tool) => tool.name === "describe_persistence_target"));

  const toolQueryResult = await runtime.executeTool("describe_active_workspace");
  assert.equal((toolQueryResult as { ok: boolean }).ok, true, "工具分发器应支持查询类 tool");

  console.log("core-regression: ok");
}

main().catch((error) => {
  console.error("core-regression: failed");
  console.error(error);
  process.exitCode = 1;
});
