import { useEffect, useMemo, useState, type FC } from "react";
import { graphWorkspaceRuntime } from "@/agent/graphWorkspaceRuntime";
import type { GraphPersistenceTarget } from "@/agent/types.ts";
import { requestGraphJsonOutputPath } from "@/services/graphFileTransfer";
import { useAgentStore } from "@/store/agentStore";
import { useGraphStore } from "@/store/graphStore";
import { toast } from "@/store/toastStore";

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderStatusTone(status: string): string {
  switch (status) {
    case "finished":
    case "succeeded":
    case "approved":
    case "saved":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "paused":
    case "blocked":
    case "requested":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "aborted":
    case "failed":
    case "rejected":
    case "cancelled":
      return "text-rose-700 bg-rose-50 border-rose-200";
    case "taken_over":
      return "text-sky-700 bg-sky-50 border-sky-200";
    default:
      return "text-text-muted bg-surface border-border";
  }
}

const AgentOperatorPanel: FC = () => {
  const operatorPanelOpen = useAgentStore((s) => s.operatorPanelOpen);
  const setOperatorPanelOpen = useAgentStore((s) => s.setOperatorPanelOpen);
  const latestSessionId = useAgentStore((s) => s.latestSessionId);
  const sessions = useAgentStore((s) => s.sessions);
  const tasks = useAgentStore((s) => s.tasks);
  const approvals = useAgentStore((s) => s.approvals);
  const events = useAgentStore((s) => s.events);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const saveStatus = useGraphStore((s) => s.saveStatus);

  const latestSession = latestSessionId ? sessions.find((session) => session.id === latestSessionId) ?? null : null;
  const latestTask = latestSession?.taskId ? tasks.find((task) => task.id === latestSession.taskId) ?? null : null;
  const pendingApprovals = approvals.filter((approval) => approval.status === "requested");
  const recentEvents = events.slice(-8).reverse();

  const workspaceSummary = useMemo(() => {
    return graphWorkspaceRuntime.queries.describeActiveWorkspace();
  }, [nodes, edges, selectedNodeId, saveStatus]);

  const [persistenceTarget, setPersistenceTarget] = useState<GraphPersistenceTarget | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRequestingExport, setIsRequestingExport] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const latestEventId = events[events.length - 1]?.id ?? null;

  useEffect(() => {
    let active = true;
    graphWorkspaceRuntime.queries.describePersistenceTarget()
      .then((result) => {
        if (!active) return;
        setPersistenceTarget(result);
        setPersistenceError(null);
      })
      .catch((error) => {
        if (!active) return;
        setPersistenceError(error instanceof Error ? error.message : "读取持久化信息失败");
      });

    return () => {
      active = false;
    };
  }, [latestEventId]);

  const handleSaveWorkspace = async () => {
    setIsSaving(true);
    try {
      const result = await graphWorkspaceRuntime.actions.saveWorkspace({
        actor: "human",
        reason: "operator-panel",
      });
      if (!result.ok) {
        toast.error(result.error?.message || "保存失败");
        return;
      }
      toast.success("工作区已通过 capability layer 保存");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestAgentExport = async () => {
    setIsRequestingExport(true);
    try {
      const result = await graphWorkspaceRuntime.actions.requestWorkspaceJsonExport({
        actor: "agent",
        scope: "all",
        reason: "operator-panel-demo",
      });
      if (result.ok) {
        toast.success("导出任务已直接完成");
        return;
      }
      if (result.error?.code === "APPROVAL_REQUIRED") {
        toast.warning("已创建导出审批，请在面板中确认");
        return;
      }
      toast.error(result.error?.message || "创建导出审批失败");
    } finally {
      setIsRequestingExport(false);
    }
  };

  const handleApprove = async (approvalId: string, filename?: string) => {
    setBusyApprovalId(approvalId);
    try {
      const outputPathResult = await requestGraphJsonOutputPath(filename);
      if (outputPathResult.status === "cancelled") {
        toast.info("未选择导出路径，审批保持待处理");
        return;
      }

      const result = await graphWorkspaceRuntime.actions.approveWorkspaceExport({
        approvalId,
        actor: "supervisor",
        outputPath: outputPathResult.status === "selected" ? outputPathResult.outputPath : undefined,
      });
      if (!result.ok) {
        toast.error(result.error?.message || "审批通过失败");
        return;
      }
      toast.success("审批通过，导出已执行");
    } finally {
      setBusyApprovalId(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    setBusyApprovalId(approvalId);
    try {
      const result = await graphWorkspaceRuntime.actions.rejectWorkspaceExport({
        approvalId,
        actor: "supervisor",
        reason: "operator_rejected",
      });
      if (!result.ok) {
        toast.error(result.error?.message || "拒绝审批失败");
        return;
      }
      toast.info("已拒绝导出审批");
    } finally {
      setBusyApprovalId(null);
    }
  };

  const handleTakeOver = async () => {
    const result = await graphWorkspaceRuntime.actions.takeOverSession({
      actor: "supervisor",
      reason: "人工接管，停止继续自动推进",
    });
    if (!result.ok) {
      toast.warning(result.error?.message || "当前没有可接管的 session");
      return;
    }
    toast.info("当前 session 已被人工接管");
  };

  const tools = graphWorkspaceRuntime.queries.getMcpContract().tools;

  if (!operatorPanelOpen) {
    return (
      <button
        type="button"
        onClick={() => setOperatorPanelOpen(true)}
        className="fixed right-4 bottom-4 z-40 rounded-full border border-border bg-white/95 px-4 py-2 text-xs font-semibold text-text shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:shadow-xl"
      >
        Agent 面板
      </button>
    );
  }

  return (
    <aside className="fixed right-4 bottom-4 z-40 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-border bg-white/95 shadow-xl backdrop-blur">
      <div className="border-b border-border bg-[linear-gradient(135deg,rgba(180,83,9,0.12),rgba(245,241,236,0.92))] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Agent Ready</div>
            <div className="mt-1 text-sm font-semibold text-text">结构化执行监管面板</div>
            <div className="mt-1 text-xs text-text-muted">UI 只是投影层；实际动作走 action / approval / task。</div>
          </div>
          <button
            type="button"
            onClick={() => setOperatorPanelOpen(false)}
            className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-text-muted transition hover:text-text"
          >
            收起
          </button>
        </div>
      </div>

      <div className="max-h-[78vh] overflow-y-auto px-4 py-4">
        <section className="rounded-xl border border-border bg-surface-dark/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-text">graph_workspace:active</div>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${renderStatusTone(workspaceSummary.saveStatus)}`}>
              {workspaceSummary.saveStatus}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-text-muted">
            <div className="rounded-lg bg-white/80 px-2 py-2">
              <div className="text-[11px] uppercase tracking-wide">节点</div>
              <div className="mt-1 text-sm font-semibold text-text">{workspaceSummary.nodeCount}</div>
            </div>
            <div className="rounded-lg bg-white/80 px-2 py-2">
              <div className="text-[11px] uppercase tracking-wide">连线</div>
              <div className="mt-1 text-sm font-semibold text-text">{workspaceSummary.edgeCount}</div>
            </div>
            <div className="rounded-lg bg-white/80 px-2 py-2">
              <div className="text-[11px] uppercase tracking-wide">选中</div>
              <div className="mt-1 text-sm font-semibold text-text">{workspaceSummary.selectedNodeCount}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            revision: <span className="font-mono text-text">{workspaceSummary.revision}</span>
          </div>
          <div className="mt-1 text-[11px] text-text-muted">
            最近变更：{formatTimestamp(workspaceSummary.lastUpdatedAt)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSaveWorkspace}
              disabled={isSaving}
              className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {isSaving ? "保存中..." : "保存工作区"}
            </button>
            <button
              type="button"
              onClick={handleRequestAgentExport}
              disabled={isRequestingExport}
              className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-text transition hover:bg-surface disabled:opacity-60"
            >
              {isRequestingExport ? "请求中..." : "模拟 Agent 导出"}
            </button>
          </div>
        </section>

        <section className="mt-3 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-text">持久化目标</div>
            {persistenceTarget && (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-muted">
                {persistenceTarget.backend}
              </span>
            )}
          </div>
          {persistenceError ? (
            <div className="mt-2 text-xs text-rose-600">{persistenceError}</div>
          ) : persistenceTarget ? (
            <div className="mt-2 space-y-1 text-xs text-text-muted">
              <div>位置：{persistenceTarget.location}</div>
              <div>存在：{persistenceTarget.exists ? "是" : "否"}</div>
              <div>大小：{persistenceTarget.byteSize} bytes</div>
              <div>更新时间：{formatTimestamp(persistenceTarget.updatedAt)}</div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-text-muted">读取中...</div>
          )}
        </section>

        <section className="mt-3 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-text">当前 session</div>
            {latestSession && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${renderStatusTone(latestSession.status)}`}>
                {latestSession.status}
              </span>
            )}
          </div>
          {latestSession ? (
            <div className="mt-2 space-y-2 text-xs text-text-muted">
              <div>目标：{latestSession.goal}</div>
              <div>动作：{latestSession.currentAction}</div>
              <div>步骤：{latestSession.currentStep}</div>
              <div>发起者：{latestSession.actor}</div>
              <div>开始时间：{formatTimestamp(latestSession.createdAt)}</div>
              {latestTask && (
                <div className="rounded-lg bg-surface px-2 py-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-text">{latestTask.title}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${renderStatusTone(latestTask.status)}`}>
                      {latestTask.status}
                    </span>
                  </div>
                  <div className="mt-1">{latestTask.message}</div>
                </div>
              )}
              <button
                type="button"
                onClick={handleTakeOver}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-surface"
              >
                人工接管当前 session
              </button>
            </div>
          ) : (
            <div className="mt-2 text-xs text-text-muted">最近还没有结构化 session。</div>
          )}
        </section>

        <section className="mt-3 rounded-xl border border-border p-3">
          <div className="text-xs font-semibold text-text">待审批动作</div>
          {pendingApprovals.length === 0 ? (
            <div className="mt-2 text-xs text-text-muted">当前没有待审批项。</div>
          ) : (
            <div className="mt-2 space-y-2">
              {pendingApprovals.map((approval) => {
                const isBusy = busyApprovalId === approval.id;
                return (
                  <div key={approval.id} className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs">
                    <div className="font-semibold text-text">{approval.title}</div>
                    <div className="mt-1 text-text-muted">{approval.riskSummary}</div>
                    <div className="mt-1 text-text-muted">输入：{approval.inputSummary}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApprove(
                          approval.id,
                          typeof approval.payload?.filename === "string" ? approval.payload.filename : undefined,
                        )}
                        disabled={isBusy}
                        className="rounded-lg bg-primary px-2.5 py-1.5 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(approval.id)}
                        disabled={isBusy}
                        className="rounded-lg border border-border bg-white px-2.5 py-1.5 font-semibold text-text transition hover:bg-surface disabled:opacity-60"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-3 rounded-xl border border-border p-3">
          <div className="text-xs font-semibold text-text">最近事件</div>
          <div className="mt-2 space-y-2">
            {recentEvents.length === 0 ? (
              <div className="text-xs text-text-muted">还没有事件流。</div>
            ) : (
              recentEvents.map((event) => (
                <div key={event.id} className="rounded-lg bg-surface px-2 py-2 text-xs text-text-muted">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text">{event.type}</span>
                    <span>{formatTimestamp(event.timestamp)}</span>
                  </div>
                  <div className="mt-1">{event.message}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-3 rounded-xl border border-border p-3">
          <div className="text-xs font-semibold text-text">MCP Tool 面</div>
          <div className="mt-2 space-y-2">
            {tools.map((tool) => (
              <div key={tool.name} className="rounded-lg border border-border bg-white px-2 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-[11px] text-text">{tool.name}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tool.visibility === "guarded" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    {tool.kind}
                  </span>
                </div>
                <div className="mt-1 text-text-muted">{tool.goal}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
};

export default AgentOperatorPanel;
