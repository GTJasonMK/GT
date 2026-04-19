import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraphStore } from "@/store/graphStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useUiStore } from "@/store/uiStore";
import { toast } from "@/store/toastStore";
import { useFocusNode } from "@/hooks/useFocusNode";
import { importGraphFromFile, requestGraphJsonOutputPath } from "@/services/graphFileTransfer";
import { exportPngDataUrl } from "@/services/imageExport";
import { CANVAS_ELEMENT_ID, SEARCH_INPUT_ID } from "@/constants/dom";
import { openConfirm } from "@/store/dialogStore";
import { graphWorkspaceRuntime } from "@/agent/graphWorkspaceRuntime";
import type { GraphImportEnvelope } from "@/agent/types.ts";

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  icon?: ReactNode;
  run: () => void | Promise<void>;
}

type QueryMode = "all" | "commands" | "nodes" | "tags";

function parsePaletteQuery(raw: string): { mode: QueryMode; query: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith(">")) {
    return { mode: "commands", query: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("@")) {
    return { mode: "nodes", query: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("#")) {
    return { mode: "tags", query: trimmed.slice(1).trim() };
  }
  return { mode: "all", query: trimmed };
}

function tokenizeQuery(value: string): string[] {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return [];

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const unique = Array.from(new Set(tokens));
  return unique.slice(0, 6);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlighted(text: string, query: string): ReactNode {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return text;

  const tokenSet = new Set(tokens);
  const escapedTokens = [...tokens].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const regex = new RegExp(`(${escapedTokens.join("|")})`, "ig");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;

  return parts.map((part, index) => {
    const isMatch = tokenSet.has(part.toLowerCase());
    if (!isMatch) return <span key={index}>{part}</span>;

    return (
      <span key={index} className="bg-primary/15 text-primary rounded px-0.5">
        {part}
      </span>
    );
  });
}

function scoreCommandMatch(args: { cmd: CommandItem; tokens: string[]; isRecent: boolean }) {
  const title = args.cmd.title.toLowerCase();
  const description = (args.cmd.description ?? "").toLowerCase();
  const keywords = (args.cmd.keywords ?? []).join(" ").toLowerCase();
  const haystack = `${title} ${description} ${keywords}`.trim();

  if (!args.tokens.every((token) => haystack.includes(token))) return 0;

  let score = 0;
  for (const token of args.tokens) {
    if (title === token) score += 120;
    else if (title.startsWith(token)) score += 90;
    else if (title.includes(token)) score += 60;

    if (keywords.includes(token)) score += 35;
    if (description.includes(token)) score += 20;
  }

  if (args.isRecent) score += 25;
  if (args.cmd.disabled) score -= 10;
  return score;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function buildSnippet(args: { content: string; tokens: string[]; maxLength?: number }) {
  const maxLength = args.maxLength ?? 90;
  const plain = stripHtml(args.content).replace(/\s+/g, " ").trim();
  if (!plain) return "";

  const lower = plain.toLowerCase();
  const positions = args.tokens
    .map((token) => ({ token, index: lower.indexOf(token) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (positions.length === 0) {
    return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
  }

  const match = positions[0];
  const contextRadius = Math.max(18, Math.floor((maxLength - match.token.length) / 2));
  const start = Math.max(0, match.index - contextRadius);
  const end = Math.min(plain.length, match.index + match.token.length + contextRadius);
  let snippet = plain.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < plain.length) snippet = `${snippet}…`;
  return snippet;
}

export default function CommandPalette() {
  const focusNode = useFocusNode();
  const reactFlow = useReactFlow();

  const isOpen = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const recentNodeIds = useUiStore((s) => s.recentNodeIds);
  const recentCommandIds = useUiStore((s) => s.recentCommandIds);

  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNodeCount = useGraphStore((s) =>
    s.nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0),
  );
  const pathFocusNodeIds = useGraphStore((s) => s.pathFocusNodeIds);
  const globalEdgeFlowAnimation = useSettingsStore((s) => s.layout.globalEdgeFlowAnimation);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const parsedQuery = useMemo(() => parsePaletteQuery(query), [query]);
  const queryTokens = useMemo(() => tokenizeQuery(parsedQuery.query), [parsedQuery.query]);
  const queryMode = parsedQuery.mode;

  const effectiveSelectedCount = selectedNodeCount > 0 ? selectedNodeCount : selectedNodeId ? 1 : 0;
  const canExportSelected = effectiveSelectedCount > 0;
  const canDuplicateSelected = canExportSelected;
  const canFocusPath = selectedNodeCount === 2;
  const hasPathFocus = pathFocusNodeIds.length > 0;
  const hasAnyRecents = recentNodeIds.length > 0 || recentCommandIds.length > 0;

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [setOpen]);

  const executeCommand = useCallback(
    async (cmd: CommandItem) => {
      if (cmd.disabled) {
        toast.warning("该命令当前不可用。");
        return;
      }

      closePalette();
      try {
        if (!cmd.id.startsWith("node:") && !cmd.id.startsWith("recent-node:")) {
          useUiStore.getState().pushRecentCommand(cmd.id);
        }
        await cmd.run();
      } catch (error) {
        console.error("命令执行失败:", error);
        toast.error("命令执行失败，请重试。");
      }
    },
    [closePalette],
  );

  // 全局快捷键：Ctrl+K 打开/关闭命令面板
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUiStore.getState().toggleCommandPalette();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 打开时：重置输入并自动聚焦
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const applyImportedEnvelope = useCallback(async (envelope: GraphImportEnvelope) => {
    let result = await graphWorkspaceRuntime.actions.applyImportedWorkspace({
      actor: "human",
      envelope,
      replaceExisting: false,
    });

    if (!result.ok && result.error?.code === "PRECONDITION_FAILED") {
      const confirmed = await openConfirm({
        title: "覆盖当前图谱？",
        message: "导入会替换当前工作区内容，是否继续？",
        confirmText: "继续导入",
        cancelText: "取消",
        danger: true,
      });
      if (!confirmed) {
        toast.info("已取消导入");
        return false;
      }
      result = await graphWorkspaceRuntime.actions.applyImportedWorkspace({
        actor: "human",
        envelope,
        replaceExisting: true,
      });
    }

    if (!result.ok) {
      toast.error(result.error?.message || "导入失败");
      return false;
    }

    if (envelope.warnings.length > 0) {
      console.warn("[导入警告]", envelope.warnings);
      toast.warning(
        `导入完成：${envelope.graph.nodes.length} 节点，${envelope.graph.edges.length} 连线（${envelope.warnings.length} 条警告，详见控制台）`,
      );
    } else {
      toast.success(`导入完成：${envelope.graph.nodes.length} 节点，${envelope.graph.edges.length} 连线`);
    }

    return true;
  }, []);

  const runHumanManagedExport = useCallback(
    async (scope: "all" | "selected", filename?: string) => {
      const request = await graphWorkspaceRuntime.actions.requestWorkspaceJsonExport({
        actor: "human",
        scope,
        filename,
        reason: "command-palette",
      });

      if (request.ok) {
        toast.success(scope === "selected" ? "选中子图已导出" : "图谱已导出");
        return;
      }

      if (request.error?.code === "PRECONDITION_FAILED") {
        toast.warning(request.error.message);
        return;
      }

      if (request.error?.code !== "APPROVAL_REQUIRED" || !request.approval) {
        toast.error(request.error?.message || "导出失败，请重试");
        return;
      }

      const confirmed = await openConfirm({
        title: scope === "selected" ? "导出选中子图？" : "导出当前图谱？",
        message: request.approval.riskSummary,
        confirmText: "确认导出",
        cancelText: "取消",
        danger: true,
      });

      if (!confirmed) {
        await graphWorkspaceRuntime.actions.rejectWorkspaceExport({
          approvalId: request.approval.id,
          actor: "human",
          reason: "human_cancelled_from_command_palette",
        });
        toast.info("已取消导出");
        return;
      }

      const outputPathResult = await requestGraphJsonOutputPath(filename);
      if (outputPathResult.status === "cancelled") {
        await graphWorkspaceRuntime.actions.rejectWorkspaceExport({
          approvalId: request.approval.id,
          actor: "human",
          reason: "human_cancelled_save_dialog_from_command_palette",
        });
        toast.info("已取消导出");
        return;
      }

      const approved = await graphWorkspaceRuntime.actions.approveWorkspaceExport({
        approvalId: request.approval.id,
        actor: "human",
        outputPath: outputPathResult.status === "selected" ? outputPathResult.outputPath : undefined,
      });
      if (!approved.ok) {
        toast.error(approved.error?.message || "导出失败，请重试");
        return;
      }

      toast.success(scope === "selected" ? "选中子图已导出" : "图谱已导出");
    },
    [],
  );

  const commands = useMemo<CommandItem[]>(() => {
    return [
      {
        id: "add-node",
        title: "添加节点",
        description: "在画布上创建一个新节点并选中",
        shortcut: "DoubleClick",
        keywords: ["新建", "node", "create"],
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        ),
        run: async () => {
          const result = await graphWorkspaceRuntime.actions.createNode({
            actor: "human",
            position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
          });
          if (!result.ok) {
            toast.error(result.error?.message || "创建节点失败。");
          }
        },
      },
      {
        id: "save",
        title: "保存图谱",
        description: "触发一次保存",
        shortcut: "Ctrl+S",
        keywords: ["save", "保存"],
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        ),
        run: async () => {
          const result = await graphWorkspaceRuntime.actions.saveWorkspace({
            actor: "human",
            reason: "command-palette",
          });
          if (!result.ok) {
            toast.error(result.error?.message || "保存失败，请重试。");
            return;
          }
          toast.info("已触发结构化保存。");
        },
      },
      {
        id: "import-file",
        title: "导入文件（JSON / Drawnix）",
        description: "从文件导入图谱数据",
        shortcut: "Ctrl+O",
        keywords: ["import", "导入", "json", "drawnix"],
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        ),
        run: async () => {
          const result = await importGraphFromFile();
          if (result.status === "cancelled") return;
          if (result.status === "invalid") {
            toast.error("导入失败：不支持的文件或格式错误。");
            return;
          }
          await applyImportedEnvelope(result);
        },
      },
      {
        id: "export-json",
        title: "导出全图 JSON",
        description: "导出当前图谱数据",
        shortcut: "Ctrl+E",
        keywords: ["export", "导出", "json"],
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        ),
        run: async () => {
          await runHumanManagedExport("all");
        },
      },
      {
        id: "export-selected-json",
        title: "导出选中 JSON",
        description: "导出选中节点及其内部连线",
        shortcut: "Alt+E",
        keywords: ["export", "导出", "选中"],
        disabled: !canExportSelected,
        run: async () => {
          await runHumanManagedExport("selected", `graph_selected_nodes_${Date.now()}.json`);
        },
      },
      {
        id: "export-image",
        title: "导出 PNG 图片",
        description: "将当前画布导出为图片",
        keywords: ["png", "图片", "导出"],
        run: async () => {
          const reactFlowElement = document.getElementById(CANVAS_ELEMENT_ID) as HTMLElement | null;
          if (!reactFlowElement) {
            toast.error("无法找到画布元素。");
            return;
          }

          const { toPng } = await import("html-to-image");
          const isDark = document.documentElement.classList.contains("dark");
          const backgroundColor = isDark ? "#0F172A" : "#F8FAFC";
          const dataUrl = await toPng(reactFlowElement, { backgroundColor, quality: 1, pixelRatio: 2 });
          await exportPngDataUrl(dataUrl);
          toast.success("图片已导出。");
        },
      },
      {
        id: "export-selected-image",
        title: "导出选中 PNG（适配视图）",
        description: "自动缩放到选中节点后导出图片",
        keywords: ["png", "图片", "导出", "选中"],
        disabled: !canExportSelected,
        run: async () => {
          const selectedIds = nodes.filter((node) => Boolean(node.selected)).map((node) => node.id);
          const effectiveSelectedIds = selectedIds.length > 0 ? selectedIds : selectedNodeId ? [selectedNodeId] : [];
          if (effectiveSelectedIds.length === 0) {
            toast.warning("请先选中一个或多个节点。");
            return;
          }

          if (!reactFlow.viewportInitialized) {
            toast.warning("画布尚未初始化，请稍后再试。");
            return;
          }

          const reactFlowElement = document.getElementById(CANVAS_ELEMENT_ID) as HTMLElement | null;
          if (!reactFlowElement) {
            toast.error("无法找到画布元素。");
            return;
          }

          const previousViewport = reactFlow.getViewport();
          try {
            await reactFlow.fitView({
              nodes: effectiveSelectedIds.map((id) => ({ id })),
              padding: 0.28,
              duration: 0,
            });

            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

            const { toPng } = await import("html-to-image");
            const isDark = document.documentElement.classList.contains("dark");
            const backgroundColor = isDark ? "#0F172A" : "#F8FAFC";
            const dataUrl = await toPng(reactFlowElement, { backgroundColor, quality: 1, pixelRatio: 2 });
            await exportPngDataUrl(dataUrl);
            toast.success("选中内容已导出为图片。");
          } finally {
            reactFlow.setViewport(previousViewport, { duration: 0 });
          }
        },
      },
      {
        id: "duplicate-selected",
        title: "复制选中（含内部连线）",
        description: "复制选中节点集合，并复制其内部连线",
        shortcut: "Ctrl+D",
        keywords: ["duplicate", "复制", "copy"],
        disabled: !canDuplicateSelected,
        run: async () => {
          const result = await graphWorkspaceRuntime.actions.duplicateNodes({
            actor: "human",
          });
          if (!result.ok) {
            toast.warning(result.error?.message || "复制选中节点失败。");
            return;
          }
          toast.success("已复制选中节点。");
        },
      },
      {
        id: "focus-shortest-path",
        title: "聚焦最短路径（选中 2 个节点）",
        description: "在两个选中节点之间寻找最短路径并高亮",
        shortcut: "Toolbar",
        keywords: ["path", "最短路径", "聚焦"],
        disabled: !canFocusPath,
        run: () => {
          const result = useGraphStore.getState().focusShortestPathBetweenSelectedNodes();
          if (!result.ok) {
            toast.warning(result.message);
            return;
          }
          toast.success(result.message);
        },
      },
      {
        id: "clear-path-focus",
        title: "清除路径聚焦",
        description: "恢复全图视图",
        keywords: ["path", "clear", "清除"],
        disabled: !hasPathFocus,
        run: () => {
          useGraphStore.getState().clearPathFocus();
          toast.info("已清除路径聚焦。");
        },
      },
      {
        id: "toggle-edge-flow",
        title: globalEdgeFlowAnimation ? "关闭全局连线流向动画" : "开启全局连线流向动画",
        description: "切换连线流向动画显示",
        keywords: ["animation", "flow", "连线"],
        run: () => {
          const { layout, setLayoutSettings } = useSettingsStore.getState();
          setLayoutSettings({ globalEdgeFlowAnimation: !layout.globalEdgeFlowAnimation });
          toast.info(layout.globalEdgeFlowAnimation ? "已关闭全局流向动画。" : "已开启全局流向动画。");
        },
      },
      {
        id: "focus-search",
        title: "聚焦搜索框",
        description: "定位到顶部搜索输入框",
        shortcut: "Ctrl+F",
        keywords: ["search", "查找", "过滤"],
        run: () => {
          const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
          if (!input) return;
          input.focus();
          input.select();
        },
      },
      {
        id: "clear-search",
        title: "清空搜索",
        description: "清空当前搜索条件",
        keywords: ["search", "清空"],
        run: () => {
          useGraphStore.getState().setSearchQuery("");
        },
      },
      {
        id: "open-shortcuts",
        title: "打开快捷键帮助",
        description: "查看操作指南与快捷键列表",
        shortcut: "?",
        keywords: ["help", "快捷键", "指南"],
        run: () => {
          setShortcutsOpen(true);
        },
      },
      {
        id: "open-settings",
        title: "打开设置",
        description: "调整画布交互参数",
        keywords: ["settings", "设置"],
        run: () => {
          setSettingsOpen(true);
        },
      },
      {
        id: "clear-recents",
        title: "清空最近记录",
        description: "清空最近访问节点与最近命令",
        keywords: ["recent", "清空", "历史"],
        disabled: !hasAnyRecents,
        run: () => {
          useUiStore.getState().clearRecents();
          toast.success("最近记录已清空。");
        },
      },
    ];
  }, [
    applyImportedEnvelope,
    canDuplicateSelected,
    canExportSelected,
    canFocusPath,
    globalEdgeFlowAnimation,
    hasAnyRecents,
    hasPathFocus,
    nodes,
    reactFlow,
    runHumanManagedExport,
    selectedNodeId,
    setSettingsOpen,
    setShortcutsOpen,
  ]);

  const commandMatches = useMemo<CommandItem[]>(() => {
    if (queryMode === "nodes" || queryMode === "tags") return [];
    if (queryTokens.length === 0) return commands;

    const recentSet = new Set(recentCommandIds);
    return commands
      .map((cmd) => ({
        cmd,
        score: scoreCommandMatch({ cmd, tokens: queryTokens, isRecent: recentSet.has(cmd.id) }),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd);
  }, [commands, queryMode, queryTokens, recentCommandIds]);

  const nodeMatches = useMemo<CommandItem[]>(() => {
    if (queryMode === "commands") return [];
    if (queryTokens.length === 0) return [];

    const recentSet = new Set(recentNodeIds);

    const scored = nodes
      .map((node) => {
        const label = (node.data.label ?? "").toLowerCase();
        const tags = (node.data.tags ?? []).map((tag) => tag.toLowerCase());
        const content = (node.data.content ?? "").toLowerCase();

        const labelMatchedTokens = queryTokens.filter((token) => label.includes(token));
        const tagMatchedTokens = queryTokens.filter((token) => tags.some((tag) => tag.includes(token)));
        const contentMatchedTokens = queryTokens.filter((token) => content.includes(token));

        if (queryMode === "tags" && tagMatchedTokens.length === 0) {
          return { node, score: 0, matchedTag: "", matchType: "none" as const };
        }

        if (queryMode !== "tags") {
          const anyMatch = labelMatchedTokens.length > 0 || tagMatchedTokens.length > 0 || contentMatchedTokens.length > 0;
          if (!anyMatch) return { node, score: 0, matchedTag: "", matchType: "none" as const };
          const allInCombined = queryTokens.every(
            (token) => label.includes(token) || tags.some((tag) => tag.includes(token)) || content.includes(token),
          );
          if (!allInCombined) return { node, score: 0, matchedTag: "", matchType: "none" as const };
        } else {
          const allInTags = queryTokens.every((token) => tags.some((tag) => tag.includes(token)));
          if (!allInTags) return { node, score: 0, matchedTag: "", matchType: "none" as const };
        }

        const isRecent = recentSet.has(node.id);
        let score = 0;

        for (const token of queryTokens) {
          if (label === token) score += 120;
          else if (label.startsWith(token)) score += 90;
          else if (label.includes(token)) score += 70;

          if (tags.some((tag) => tag === token)) score += 60;
          else if (tags.some((tag) => tag.startsWith(token))) score += 50;
          else if (tags.some((tag) => tag.includes(token))) score += 40;

          if (content.includes(token)) score += 18;
        }

        let matchType: "label" | "tag" | "content" = "content";
        if (labelMatchedTokens.length > 0) matchType = "label";
        else if (tagMatchedTokens.length > 0) matchType = "tag";
        else matchType = "content";

        const matchedTag =
          matchType === "tag" ? node.data.tags?.find((tag) => queryTokens.some((token) => tag.toLowerCase().includes(token))) ?? "" : "";

        if (isRecent) score += 20;
        return { node, score, matchedTag, matchType };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return scored.map(({ node, matchedTag, matchType }) => {
      const tags = node.data.tags?.slice(0, 4) ?? [];
      const tagSummary = tags.length > 0 ? `标签：${tags.join("、")}` : "";
      const snippet = node.data.content ? buildSnippet({ content: node.data.content, tokens: queryTokens }) : "";

      const description =
        queryMode === "tags"
          ? `匹配标签：${matchedTag || queryTokens.join(" ")}`
          : matchType === "content" && snippet
            ? `内容：${snippet}`
            : tagSummary || "跳转并选中该节点";
      return {
        id: `node:${node.id}`,
        title: node.data.label || "未命名",
        description,
        keywords: tags,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="7" />
            <path d="M12 9v6" />
            <path d="M9 12h6" />
          </svg>
        ),
        run: () => {
          const latest = useGraphStore.getState().nodes.find((item) => item.id === node.id);
          if (!latest) return;
          useGraphStore.getState().setSelectedNodeId(node.id);
          try {
            if (reactFlow.viewportInitialized) {
              focusNode(latest);
            }
          } catch (error) {
            console.warn("定位节点失败:", error);
          }
        },
      };
    });
  }, [focusNode, nodes, queryMode, queryTokens, reactFlow.viewportInitialized, recentNodeIds]);

  const recentNodeItems = useMemo<CommandItem[]>(() => {
    if (queryTokens.length > 0) return [];
    if (recentNodeIds.length === 0) return [];

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return recentNodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is (typeof nodes)[number] => Boolean(node))
      .slice(0, 6)
      .map((node) => ({
        id: `recent-node:${node.id}`,
        title: node.data.label || "未命名",
        description: "最近访问的节点",
        keywords: ["recent", "最近"],
        run: () => {
          const latest = useGraphStore.getState().nodes.find((item) => item.id === node.id);
          if (!latest) return;
          useGraphStore.getState().setSelectedNodeId(node.id);
          if (reactFlow.viewportInitialized) {
            focusNode(latest);
          }
        },
      }));
  }, [focusNode, nodes, queryTokens.length, reactFlow.viewportInitialized, recentNodeIds]);

  const { recentCommands, otherCommands } = useMemo(() => {
    const commandById = new Map(commands.map((cmd) => [cmd.id, cmd]));
    const resolvedRecentCommands = recentCommandIds
      .map((id) => commandById.get(id))
      .filter((cmd): cmd is CommandItem => Boolean(cmd))
      .slice(0, 6);

    const recentCommandIdSet = new Set(resolvedRecentCommands.map((cmd) => cmd.id));
    const resolvedOtherCommands = commands.filter((cmd) => !recentCommandIdSet.has(cmd.id));

    return { recentCommands: resolvedRecentCommands, otherCommands: resolvedOtherCommands };
  }, [commands, recentCommandIds]);

  type Section = { id: string; title: string; items: CommandItem[] };

  const sections = useMemo<Section[]>(() => {
    const result: Section[] = [];
    const hasQuery = queryTokens.length > 0;

    const pushSection = (id: string, title: string, items: CommandItem[]) => {
      if (items.length === 0) return;
      result.push({ id, title, items });
    };

    if (!hasQuery) {
      if (queryMode === "all") {
        pushSection("recent-nodes", "最近节点", recentNodeItems);
        pushSection("recent-commands", "最近命令", recentCommands);
        pushSection("all-commands", "全部命令", otherCommands);
      } else if (queryMode === "commands") {
        pushSection("recent-commands", "最近命令", recentCommands);
        pushSection("all-commands", "全部命令", otherCommands);
      } else if (queryMode === "nodes" || queryMode === "tags") {
        pushSection("recent-nodes", "最近节点", recentNodeItems);
      }

      return result;
    }

    if (queryMode === "commands") {
      pushSection("commands", "命令", commandMatches);
      return result;
    }

    if (queryMode === "nodes" || queryMode === "tags") {
      pushSection("nodes", queryMode === "tags" ? "标签匹配节点" : "节点", nodeMatches);
      return result;
    }

    pushSection("nodes", "节点", nodeMatches);
    pushSection("commands", "命令", commandMatches);
    return result;
  }, [
    commandMatches,
    nodeMatches,
    otherCommands,
    queryMode,
    queryTokens.length,
    recentCommands,
    recentNodeItems,
  ]);

  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!isOpen) return;
    if (items.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((idx) => Math.max(0, Math.min(idx, items.length - 1)));
  }, [isOpen, items.length]);

  useEffect(() => {
    if (!isOpen) return;
    const container = listRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    if (!active) return;
    active.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const activeCommand = items[activeIndex] ?? null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === "Enter" && activeCommand) {
      e.preventDefault();
      void executeCommand(activeCommand);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/45 flex items-start justify-center pt-[12vh] px-4"
      onClick={() => closePalette()}
    >
      <div
        className="w-full max-w-2xl bg-white border border-border rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="text-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 21l-4.35-4.35" />
                <circle cx="11" cy="11" r="7" />
              </svg>
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="搜索命令或节点…（Ctrl+K）"
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted/60"
              autoFocus
            />
            <button
              onClick={() => closePalette()}
              className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
              aria-label="关闭"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-1 text-[11px] text-text-muted flex items-center justify-between">
            <span>Enter 执行 · ↑↓ 选择 · Esc 关闭</span>
            <span className="text-text-muted/80">提示：<span className="font-mono">{">"}</span> 命令 · <span className="font-mono">@</span> 节点 · <span className="font-mono">#tag</span> 标签</span>
          </div>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-5 text-sm text-text-muted">
              {queryTokens.length === 0
                ? queryMode === "commands"
                  ? "输入关键字搜索命令（例如：> 导出）"
                  : queryMode === "nodes"
                    ? "输入关键字搜索节点（例如：@ 需求）"
                    : queryMode === "tags"
                      ? "输入 #tag 按标签搜索节点（例如：#todo）"
                      : "输入关键字搜索命令或节点…"
                : queryMode === "commands"
                  ? "没有匹配的命令"
                  : queryMode === "nodes" || queryMode === "tags"
                    ? "没有匹配的节点"
                    : "没有匹配的结果"}
            </div>
          ) : (
            (() => {
              let globalIndex = 0;
              const highlightQuery = parsedQuery.query;

              return sections.map((section) => {
                const showTitle = sections.length > 1 || queryTokens.length === 0;
                return (
                  <div key={section.id}>
                    {showTitle && (
                      <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-text-muted/80 uppercase tracking-wider">
                        {section.title}
                      </div>
                    )}

                    {section.items.map((cmd) => {
                      const index = globalIndex++;
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={cmd.id}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => void executeCommand(cmd)}
                          disabled={cmd.disabled}
                          data-cmd-index={index}
                          className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer
                            ${cmd.disabled ? "opacity-50 cursor-not-allowed" : ""}
                            ${isActive ? "bg-surface" : "hover:bg-surface/70"}
                          `}
                        >
                          <div className={`mt-0.5 w-5 h-5 flex items-center justify-center rounded ${isActive ? "text-primary" : "text-text-muted"}`}>
                            {cmd.icon || (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 16v-4" />
                                <path d="M12 8h.01" />
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm font-medium text-text">{renderHighlighted(cmd.title, highlightQuery)}</div>
                              {cmd.shortcut && (
                                <div className="text-[11px] text-text-muted font-mono shrink-0">{cmd.shortcut}</div>
                              )}
                            </div>
                            {cmd.description && (
                              <div className="mt-0.5 text-xs text-text-muted leading-snug">
                                {renderHighlighted(cmd.description, highlightQuery)}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
}
