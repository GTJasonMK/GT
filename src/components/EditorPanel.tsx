import { useEffect, useMemo, useState, type FC } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useGraphStore } from "@/store/graphStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { EdgeColor, LockMode, NodeColor } from "@/types";
import { EDGE_COLOR_OPTIONS, EDGE_COLORS, NODE_COLORS } from "@/types";
import type { Node } from "@xyflow/react";
import type { KnowledgeNodeData } from "@/types";
import { useFocusNode } from "@/hooks/useFocusNode";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;
type EditorTab = "features" | "content";

const LOCK_DEPTH_MIN = 1;
const LOCK_DEPTH_MAX = 8;
const LAYOUT_RING_SPACING_MIN = 96;
const LAYOUT_RING_SPACING_MAX = 260;
const LAYOUT_NODE_SPACING_MIN = 96;
const LAYOUT_NODE_SPACING_MAX = 260;
const LAYOUT_MAX_ATTEMPTS_MIN = 1;
const LAYOUT_MAX_ATTEMPTS_MAX = 24;

const LAYOUT_PRESETS = [
  {
    id: "compact",
    label: "紧凑",
    description: "更小间距，适合快速收拢当前子图",
    layoutStyle: "layered" as const,
    ringSpacing: 112,
    nodeSpacing: 108,
    maxAttempts: 8,
  },
  {
    id: "balanced",
    label: "平衡",
    description: "默认参数，适合大多数场景",
    layoutStyle: "radial" as const,
    ringSpacing: 140,
    nodeSpacing: 140,
    maxAttempts: 12,
  },
  {
    id: "spacious",
    label: "宽松",
    description: "更大间距，适合阅读密集关系",
    layoutStyle: "radial" as const,
    ringSpacing: 184,
    nodeSpacing: 176,
    maxAttempts: 16,
  },
];

const LOCK_MODE_OPTIONS: Array<{ value: LockMode; label: string; description: string }> = [
  { value: "direct", label: "相邻", description: "仅固定直接子节点" },
  { value: "level", label: "层级", description: "固定指定层级内的子节点" },
  { value: "transitive", label: "传递", description: "固定全部可达子节点" },
];

function clampLockDepth(value: number): number {
  return Math.min(LOCK_DEPTH_MAX, Math.max(LOCK_DEPTH_MIN, Math.floor(value)));
}

function getLockModeLabel(lockMode: LockMode, lockDepth?: number): string {
  if (lockMode === "transitive") return "传递（所有可达子节点）";
  if (lockMode === "level") return `固定前 ${clampLockDepth(lockDepth ?? 1)} 级子节点`;
  return "仅固定直接子节点";
}

function areNodesEqualByIdAndData(prev: GraphNode[], next: GraphNode[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.id !== next[i]?.id) return false;
    if (prev[i]?.data !== next[i]?.data) return false;
  }
  return true;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}

const ToolbarButton: FC<ToolbarButtonProps> = ({ onClick, isActive, disabled, children, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded-md transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
      ${isActive
        ? "bg-primary text-white shadow-sm"
        : "text-text-muted hover:bg-surface hover:text-text hover:shadow-sm"
      }
    `}
  >
    {children}
  </button>
);

const EditorPanel: FC = () => {
  const focusNode = useFocusNode();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useStoreWithEqualityFn(useGraphStore, (s) => s.nodes, areNodesEqualByIdAndData);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const autoLayoutFromNode = useGraphStore((s) => s.autoLayoutFromNode);
  const layoutSettings = useSettingsStore((s) => s.layout);
  const setLayoutSettings = useSettingsStore((s) => s.setLayoutSettings);
  const resetLayoutSettings = useSettingsStore((s) => s.resetLayoutSettings);

  const [layoutCrossings, setLayoutCrossings] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("features");
  const [lockModeDraft, setLockModeDraft] = useState<LockMode>("direct");
  const [lockDepthDraft, setLockDepthDraft] = useState<number>(2);
  const [showGlobalLayoutConfirm, setShowGlobalLayoutConfirm] = useState(false);
  const [skipGlobalLayoutConfirm, setSkipGlobalLayoutConfirm] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const nodeData = selectedNode?.data;
  const hasSelectedNode = Boolean(selectedNodeId && nodeData);

  const editor = useEditor({
    extensions: [StarterKit],
    content: nodeData?.content || "",
    onUpdate: ({ editor }) => {
      if (selectedNodeId) {
        updateNodeData(selectedNodeId, { content: editor.getHTML() });
      }
    },
  });

  useEffect(() => {
    if (!editor || !nodeData) return;
    const currentContent = editor.getHTML();
    if (currentContent !== nodeData.content) {
      editor.commands.setContent(nodeData.content || "");
    }
  }, [selectedNodeId, nodeData?.content, editor]);

  useEffect(() => {
    if (!nodeData) return;
    setLockModeDraft(nodeData.lockMode || "direct");
    setLockDepthDraft(clampLockDepth(nodeData.lockDepth ?? 2));
  }, [selectedNodeId, nodeData?.lockMode, nodeData?.lockDepth]);

  useEffect(() => {
    setLayoutCrossings(null);
  }, [selectedNodeId]);

  const edgeColorOptions = EDGE_COLOR_OPTIONS;
  const rawEdgeColor = nodeData?.edgeColor;
  const currentEdgeColor: EdgeColor =
    rawEdgeColor && Object.prototype.hasOwnProperty.call(EDGE_COLORS, rawEdgeColor)
      ? rawEdgeColor
      : "default";
  const currentEdgeColorIndex = Math.max(0, edgeColorOptions.indexOf(currentEdgeColor));

  const lockStatusText = useMemo(() => {
    if (!nodeData?.locked || !nodeData.lockMode) return "当前未启用拖拽锁定";
    return `当前已锁定：${getLockModeLabel(nodeData.lockMode, nodeData.lockDepth)}`;
  }, [nodeData?.locked, nodeData?.lockMode, nodeData?.lockDepth]);

  const activeLayoutPresetId = useMemo(() => {
    const preset = LAYOUT_PRESETS.find((item) =>
      item.layoutStyle === layoutSettings.layoutStyle
      && item.ringSpacing === layoutSettings.ringSpacing
      && item.nodeSpacing === layoutSettings.nodeSpacing
      && item.maxAttempts === layoutSettings.maxAttempts,
    );
    return preset?.id ?? null;
  }, [
    layoutSettings.layoutStyle,
    layoutSettings.ringSpacing,
    layoutSettings.nodeSpacing,
    layoutSettings.maxAttempts,
  ]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedNodeId) return;
    updateNodeData(selectedNodeId, { label: e.target.value });
  };

  const handleTagAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !selectedNodeId || !nodeData) return;
    const input = e.currentTarget;
    const tag = input.value.trim();
    if (tag && !nodeData.tags.includes(tag)) {
      updateNodeData(selectedNodeId, { tags: [...nodeData.tags, tag] });
    }
    input.value = "";
  };

  const handleTagRemove = (tag: string) => {
    if (!selectedNodeId || !nodeData) return;
    updateNodeData(selectedNodeId, {
      tags: nodeData.tags.filter((t) => t !== tag),
    });
  };

  const handleColorChange = (color: NodeColor) => {
    if (!selectedNodeId) return;
    updateNodeData(selectedNodeId, { color });
  };

  const handleEdgeColorIndexChange = (index: number) => {
    if (!selectedNodeId) return;
    const edgeColor = edgeColorOptions[index];
    if (!edgeColor) return;
    updateNodeData(selectedNodeId, { edgeColor });
  };

  const handleDelete = () => {
    if (!selectedNodeId) return;
    deleteNode(selectedNodeId);
  };

  const handleAutoLayout = () => {
    if (!selectedNodeId) return;
    const result = autoLayoutFromNode(selectedNodeId, {
      layoutStyle: layoutSettings.layoutStyle,
      includeOtherComponents: false,
      ringSpacing: layoutSettings.ringSpacing,
      nodeSpacing: layoutSettings.nodeSpacing,
      maxAttempts: layoutSettings.maxAttempts,
    });
    if (!result.ok) {
      alert("无法整理：未找到可用布局（可能是节点不存在或图数据异常）。");
      return;
    }

    setLayoutCrossings(result.crossings);
    const latestNode = useGraphStore.getState().nodes.find((n) => n.id === selectedNodeId);
    if (latestNode) focusNode(latestNode);
  };

  const runAutoLayoutAllComponents = () => {
    if (!selectedNodeId) return;
    const result = autoLayoutFromNode(selectedNodeId, {
      layoutStyle: layoutSettings.layoutStyle,
      includeOtherComponents: true,
      ringSpacing: layoutSettings.ringSpacing,
      nodeSpacing: layoutSettings.nodeSpacing,
      maxAttempts: layoutSettings.maxAttempts,
    });
    if (!result.ok) {
      alert("无法整理：未找到可用布局（可能是节点不存在或图数据异常）。");
      return;
    }

    setLayoutCrossings(result.crossings);
    const latestNode = useGraphStore.getState().nodes.find((n) => n.id === selectedNodeId);
    if (latestNode) focusNode(latestNode);
  };

  const handleAutoLayoutAllComponents = () => {
    if (!selectedNodeId) return;
    if (layoutSettings.confirmBeforeGlobalLayout) {
      setSkipGlobalLayoutConfirm(false);
      setShowGlobalLayoutConfirm(true);
      return;
    }
    runAutoLayoutAllComponents();
  };

  const handleConfirmGlobalLayout = () => {
    if (skipGlobalLayoutConfirm) {
      setLayoutSettings({ confirmBeforeGlobalLayout: false });
    }
    setShowGlobalLayoutConfirm(false);
    runAutoLayoutAllComponents();
  };

  const handleApplyLock = () => {
    if (!selectedNodeId) return;
    const normalizedDepth = clampLockDepth(lockDepthDraft);
    updateNodeData(selectedNodeId, {
      locked: true,
      lockMode: lockModeDraft,
      lockDepth: lockModeDraft === "level" ? normalizedDepth : undefined,
    });
  };

  const handleUnlock = () => {
    if (!selectedNodeId) return;
    updateNodeData(selectedNodeId, {
      locked: false,
      lockMode: undefined,
      lockDepth: undefined,
    });
  };

  const renderHeader = () => (
    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 bg-primary rounded-full" />
        <span className="text-sm font-semibold text-text tracking-tight">节点面板</span>
      </div>
      {nodeData && (
        <div
          className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-black/10"
          style={{ backgroundColor: NODE_COLORS[nodeData.color || "default"].border }}
          title={`颜色: ${nodeData.color || "default"}`}
        />
      )}
    </div>
  );

  const renderTabSwitch = () => (
    <div className="px-4 py-2 border-b border-border bg-surface/20">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1">
        <button
          onClick={() => setActiveTab("features")}
          className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
            activeTab === "features"
              ? "bg-white text-text shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          功能
        </button>
        <button
          onClick={() => setActiveTab("content")}
          className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
            activeTab === "content"
              ? "bg-white text-text shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          内容
        </button>
      </div>
    </div>
  );

  const renderEmptyState = () => (
    <div className="flex-1 flex flex-col items-center justify-center text-text-muted text-sm gap-3 px-6">
      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
      </div>
      <span className="font-medium">点击节点后即可在此编辑</span>
      <span className="text-xs text-text-muted/60">“功能”用于操作，“内容”用于编辑文本</span>
    </div>
  );

  const renderFeatureTab = () => {
    if (!selectedNodeId || !nodeData) return null;

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-border">
            <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">颜色</div>
            <div className="flex gap-1.5">
              {(Object.keys(NODE_COLORS) as NodeColor[]).map((color) => (
                <button
                  key={color}
                  onClick={() => handleColorChange(color)}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-all duration-150 hover:scale-110 ring-1 ring-black/10
                    ${nodeData.color === color || (!nodeData.color && color === "default")
                      ? "ring-2 ring-primary ring-offset-2 scale-110"
                      : ""
                    }
                  `}
                  style={{ backgroundColor: NODE_COLORS[color].border }}
                  title={color === "default" ? "默认" : color}
                />
              ))}
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-border">
            <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">重要度</div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-10 rounded-full" style={{ backgroundColor: EDGE_COLORS[currentEdgeColor].stroke }} />
              <div className="text-xs text-text-muted font-medium">{EDGE_COLORS[currentEdgeColor].label}</div>
            </div>
            <input
              type="range"
              min={0}
              max={edgeColorOptions.length - 1}
              step={1}
              value={currentEdgeColorIndex}
              onChange={(e) => handleEdgeColorIndexChange(Number(e.currentTarget.value))}
              className="w-full mt-2 accent-primary cursor-pointer"
              title={EDGE_COLORS[currentEdgeColor].description}
            />
            <div className="flex justify-between text-[10px] text-text-muted/60 mt-1">
              <span>{EDGE_COLORS[edgeColorOptions[0]].label}</span>
              <span>{EDGE_COLORS[edgeColorOptions[edgeColorOptions.length - 1]].label}</span>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-border">
            <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">拖拽锁定</div>
            <div className="grid grid-cols-3 gap-1.5">
              {LOCK_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setLockModeDraft(option.value)}
                  className={`px-2 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                    lockModeDraft === option.value
                      ? "bg-primary text-white shadow-sm"
                      : "bg-surface text-text-muted hover:text-text"
                  }`}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {lockModeDraft === "level" && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-text-muted/80">
                  <span>固定层级</span>
                  <span>{clampLockDepth(lockDepthDraft)} 级</span>
                </div>
                <input
                  type="range"
                  min={LOCK_DEPTH_MIN}
                  max={LOCK_DEPTH_MAX}
                  step={1}
                  value={clampLockDepth(lockDepthDraft)}
                  onChange={(e) => setLockDepthDraft(Number(e.currentTarget.value))}
                  className="w-full mt-1 accent-primary cursor-pointer"
                />
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleApplyLock}
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-surface hover:bg-surface-hover text-text transition-all cursor-pointer"
              >
                应用锁定
              </button>
              <button
                onClick={handleUnlock}
                disabled={!nodeData.locked}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text hover:bg-surface transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                解除
              </button>
            </div>
            <div className="mt-2 text-xs text-text-muted/70">{lockStatusText}</div>
          </div>

          <div className="px-4 py-2.5 border-b border-border">
            <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">布局</div>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setLayoutSettings({
                    layoutStyle: preset.layoutStyle,
                    ringSpacing: preset.ringSpacing,
                    nodeSpacing: preset.nodeSpacing,
                    maxAttempts: preset.maxAttempts,
                  })}
                  className={`px-2 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                    activeLayoutPresetId === preset.id
                      ? "bg-primary text-white shadow-sm"
                      : "bg-surface text-text-muted hover:text-text"
                  }`}
                  title={preset.description}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1.5 mb-2">
              <button
                onClick={() => setLayoutSettings({ layoutStyle: "radial" })}
                className={`px-2 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                  layoutSettings.layoutStyle === "radial"
                    ? "bg-primary text-white shadow-sm"
                    : "bg-surface text-text-muted hover:text-text"
                }`}
                title="发散同心圆布局"
              >
                发散
              </button>
              <button
                onClick={() => setLayoutSettings({ layoutStyle: "layered" })}
                className={`px-2 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                  layoutSettings.layoutStyle === "layered"
                    ? "bg-primary text-white shadow-sm"
                    : "bg-surface text-text-muted hover:text-text"
                }`}
                title="分层树状布局"
              >
                分层
              </button>
            </div>

            <div className="mb-2">
              <div className="flex items-center justify-between text-[11px] text-text-muted/80">
                <span>层间距</span>
                <span>{layoutSettings.ringSpacing}px</span>
              </div>
              <input
                type="range"
                min={LAYOUT_RING_SPACING_MIN}
                max={LAYOUT_RING_SPACING_MAX}
                step={8}
                value={layoutSettings.ringSpacing}
                onChange={(e) => setLayoutSettings({ ringSpacing: Number(e.currentTarget.value) })}
                className="w-full mt-1 accent-primary cursor-pointer"
              />
            </div>

            <div className="mb-2">
              <div className="flex items-center justify-between text-[11px] text-text-muted/80">
                <span>同层间距</span>
                <span>{layoutSettings.nodeSpacing}px</span>
              </div>
              <input
                type="range"
                min={LAYOUT_NODE_SPACING_MIN}
                max={LAYOUT_NODE_SPACING_MAX}
                step={8}
                value={layoutSettings.nodeSpacing}
                onChange={(e) => setLayoutSettings({ nodeSpacing: Number(e.currentTarget.value) })}
                className="w-full mt-1 accent-primary cursor-pointer"
              />
            </div>

            <div className="mb-2">
              <div className="flex items-center justify-between text-[11px] text-text-muted/80">
                <span>尝试次数</span>
                <span>{layoutSettings.maxAttempts}</span>
              </div>
              <input
                type="range"
                min={LAYOUT_MAX_ATTEMPTS_MIN}
                max={LAYOUT_MAX_ATTEMPTS_MAX}
                step={1}
                value={layoutSettings.maxAttempts}
                onChange={(e) => setLayoutSettings({ maxAttempts: Number(e.currentTarget.value) })}
                className="w-full mt-1 accent-primary cursor-pointer"
              />
            </div>

            <button
              onClick={resetLayoutSettings}
              className="w-full mb-2 px-2 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text hover:bg-surface transition-all cursor-pointer"
              title="恢复默认布局参数"
            >
              恢复布局默认参数
            </button>

            <button
              onClick={handleAutoLayout}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-surface hover:bg-surface-hover text-text transition-all duration-150 cursor-pointer"
              title="以当前节点为中心，仅整理当前连通子图（不会影响不相连的其它图，可撤销）"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9" />
                <polyline points="22 4 21 12 13 11" />
              </svg>
              整理当前群组
            </button>
            <button
              onClick={handleAutoLayoutAllComponents}
              className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border text-text-muted hover:text-text hover:bg-surface transition-all duration-150 cursor-pointer"
              title="以当前节点为锚点，同时整理所有不相交群组（会移动更多节点，可撤销）"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="6" r="2" />
                <circle cx="6" cy="18" r="2" />
                <circle cx="18" cy="18" r="2" />
                <line x1="8" y1="6" x2="16" y2="6" />
                <line x1="6" y1="8" x2="6" y2="16" />
              </svg>
              整理全部群组
            </button>
            <label className="mt-2 flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={layoutSettings.confirmBeforeGlobalLayout}
                onChange={(e) => setLayoutSettings({ confirmBeforeGlobalLayout: e.currentTarget.checked })}
                className="accent-primary"
              />
              全局整理前弹窗确认
            </label>
            <div className="mt-2 text-xs text-text-muted/70">
              只调整位置，不修改内容；“整理当前群组”不会影响不相交群组。已锁定节点会保持原位，可撤销（Ctrl+Z）。
            </div>
            {layoutCrossings !== null && (
              <div className={`mt-2 text-xs ${layoutCrossings === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                {layoutCrossings === 0
                  ? "已整理：估算零交叉。"
                  : `已整理：估算交叉数 ${layoutCrossings}（可继续手动微调；部分图在数学上无法完全无交叉）。`}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-between items-center bg-surface/20">
          <span className="text-[11px] text-text-muted/70">
            创建于 {new Date(nodeData.createdAt).toLocaleDateString("zh-CN")}
          </span>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 font-medium"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            删除节点
          </button>
        </div>
      </div>
    );
  };

  const renderContentTab = () => {
    if (!selectedNodeId || !nodeData) return null;

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-border">
          <input
            type="text"
            value={nodeData.label || ""}
            onChange={handleTitleChange}
            className="w-full text-base font-semibold outline-none bg-transparent text-text placeholder:text-text-muted/40 input-focus"
            placeholder="节点标题"
          />
        </div>

        <div className="px-4 py-2.5 border-b border-border">
          <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">标签</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {nodeData.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-primary/10 text-primary rounded-full cursor-pointer hover:bg-primary hover:text-white transition-all duration-150 font-medium group"
                onClick={() => handleTagRemove(tag)}
              >
                {tag}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-60 group-hover:opacity-100"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </span>
            ))}
            <input
              type="text"
              onKeyDown={handleTagAdd}
              className="text-xs outline-none bg-transparent min-w-[60px] flex-1 text-text-muted placeholder:text-text-muted/40"
              placeholder={nodeData.tags.length === 0 ? "输入标签后回车" : "+ 添加"}
            />
          </div>
        </div>

        {editor && (
          <div className="px-4 py-2.5 border-b border-border bg-surface/30">
            <div className="text-[10px] text-text-muted/70 mb-2 font-medium uppercase tracking-wider">格式</div>
            <div className="flex items-center gap-0.5 flex-wrap">
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={editor.isActive("bold")}
                title="加粗 (Ctrl+B)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive("italic")}
                title="斜体 (Ctrl+I)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive("strike")}
                title="删除线"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" /><path d="M17.5 7.5c-.7-1.5-2.4-2.5-5.5-2.5-4 0-6 2-6 4 0 1.5 1 3 6 4" /><path d="M8.5 16c.5 1.5 2.5 3 5.5 3 4 0 6-1.5 6-3.5 0-.5-.1-1-.4-1.5" />
                </svg>
              </ToolbarButton>

              <div className="w-px h-4 bg-border mx-1" />

              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                isActive={editor.isActive("heading", { level: 1 })}
                title="标题1"
              >
                <span className="text-xs font-bold">H1</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                isActive={editor.isActive("heading", { level: 2 })}
                title="标题2"
              >
                <span className="text-xs font-bold">H2</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                isActive={editor.isActive("heading", { level: 3 })}
                title="标题3"
              >
                <span className="text-xs font-bold">H3</span>
              </ToolbarButton>

              <div className="w-px h-4 bg-border mx-1" />

              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                isActive={editor.isActive("bulletList")}
                title="无序列表"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                isActive={editor.isActive("orderedList")}
                title="有序列表"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
                  <text x="2" y="8" fontSize="8" fill="currentColor" fontWeight="bold">1</text>
                  <text x="2" y="14" fontSize="8" fill="currentColor" fontWeight="bold">2</text>
                  <text x="2" y="20" fontSize="8" fill="currentColor" fontWeight="bold">3</text>
                </svg>
              </ToolbarButton>

              <div className="w-px h-4 bg-border mx-1" />

              <ToolbarButton
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                isActive={editor.isActive("codeBlock")}
                title="代码块"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                isActive={editor.isActive("blockquote")}
                title="引用"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
                  <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
                </svg>
              </ToolbarButton>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <EditorContent
            editor={editor}
            className="prose prose-sm max-w-none h-full [&_.tiptap]:outline-none [&_.tiptap]:h-full [&_.tiptap]:min-h-[200px]"
          />
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-between items-center bg-surface/20">
          <span className="text-[11px] text-text-muted/70">
            创建于 {new Date(nodeData.createdAt).toLocaleDateString("zh-CN")}
          </span>
          <span className="text-[11px] text-text-muted/70">{nodeData.tags.length} 个标签</span>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white animate-fadeIn">
      {renderHeader()}
      {renderTabSwitch()}
      {!hasSelectedNode && renderEmptyState()}
      {hasSelectedNode && activeTab === "features" && renderFeatureTab()}
      {hasSelectedNode && activeTab === "content" && renderContentTab()}

      {showGlobalLayoutConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-border shadow-xl p-4">
            <div className="text-sm font-semibold text-text">确认整理全部群组</div>
            <div className="mt-2 text-xs text-text-muted leading-5">
              该操作会移动当前画布中的所有不相交群组，可能导致你手工调整的位置被重排。
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={skipGlobalLayoutConfirm}
                onChange={(e) => setSkipGlobalLayoutConfirm(e.currentTarget.checked)}
                className="accent-primary"
              />
              下次不再提示
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowGlobalLayoutConfirm(false);
                  setSkipGlobalLayoutConfirm(false);
                }}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text hover:bg-surface transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmGlobalLayout}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary-dark transition-all cursor-pointer"
              >
                继续整理
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorPanel;
