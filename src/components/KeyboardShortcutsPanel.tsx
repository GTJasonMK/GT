import { useEffect, useMemo, useState, type FC } from "react";

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface GuideItem {
  feature: string;
  usage: string;
  tip?: string;
}

interface GuideSection {
  title: string;
  items: GuideItem[];
}

interface FilteredGuideSection {
  id: string;
  title: string;
  items: GuideItem[];
}

const shortcuts: ShortcutItem[] = [
  { keys: ["Ctrl", "S"], description: "保存数据" },
  { keys: ["Ctrl", "Z"], description: "撤销操作" },
  { keys: ["Ctrl", "Y"], description: "重做操作" },
  { keys: ["Ctrl", "Shift", "Z"], description: "重做操作" },
  { keys: ["Ctrl", "D"], description: "复制选中节点" },
  { keys: ["Ctrl", "F"], description: "聚焦搜索框" },
  { keys: ["F"], description: "聚焦选中节点 / 全览" },
  { keys: ["Escape"], description: "取消选中 / 清空搜索" },
  { keys: ["Delete"], description: "删除选中节点" },
  { keys: ["Backspace"], description: "删除选中节点" },
];

const mouseActions = [
  { action: "左键拖拽空白处", description: "框选多个节点" },
  { action: "中键拖拽", description: "平移画布" },
  { action: "右键+WASD", description: "平移画布" },
  { action: "右键单击", description: "打开上下文菜单" },
  { action: "双击画布", description: "创建新节点" },
  { action: "滚轮", description: "缩放画布" },
  { action: "双指滑动", description: "平移画布 (触摸屏)" },
  { action: "双指缩放", description: "缩放画布 (触摸屏)" },
];

const guideSections: GuideSection[] = [
  {
    title: "快速开始",
    items: [
      {
        feature: "创建图谱",
        usage: "双击画布空白处或点击顶部“添加节点”创建节点，拖动节点中心连接点即可创建连线。",
      },
      {
        feature: "编辑节点",
        usage: "点击节点后，在右侧“内容”页编辑标题、标签和富文本；在“功能”页调整颜色、重要度、布局和锁定。",
      },
      {
        feature: "保存与恢复",
        usage: "支持手动保存（Ctrl+S）与自动保存（节点/连线变化后约 1 秒）；启动时自动加载历史数据。",
        tip: "Web 端保存到 localStorage，桌面端保存到系统应用数据目录。",
      },
    ],
  },
  {
    title: "顶部工具栏",
    items: [
      {
        feature: "文件操作",
        usage: "可保存、导出 JSON、导入 JSON/Drawnix、导出图片，以及将文本快速转成图谱。",
      },
      {
        feature: "导出选中",
        usage: "先框选多个节点（或单选一个节点）后，使用“导出选中(N)”导出选中节点及其内部连线。",
      },
      {
        feature: "批量编辑",
        usage: "选中节点后点击“批量编辑(N)”，可批量设置节点颜色、连线重要度、标签追加/替换、统一锁定或解锁。",
      },
      {
        feature: "路径聚焦",
        usage: "先框选两个节点，点击“聚焦路径”自动寻找最短路径并高亮；点击“清除聚焦”恢复全图视图。",
        tip: "路径计算优先按有向边，找不到时会回退到无向近邻。",
      },
      {
        feature: "视图与系统按钮",
        usage: "支持全局连线流向动画、深浅色切换、设置面板（平移速度/缩放幅度）和帮助面板。",
      },
    ],
  },
  {
    title: "画布操作",
    items: [
      {
        feature: "导航与缩放",
        usage: "可用中键拖拽、右键+WASD、滚轮、Ctrl+滚轮、双指手势进行平移缩放；F 键可聚焦选中节点或全览。",
      },
      {
        feature: "小地图与控制器",
        usage: "右下角按钮可显示/隐藏小地图；内置 Controls 支持快速缩放与视图复位。",
      },
      {
        feature: "右键上下文菜单",
        usage: "右键空白处可添加节点；右键节点可编辑/复制/删除；右键连线可编辑标签、快捷标签、清除标签或删除连接。",
      },
      {
        feature: "连线标签编辑",
        usage: "双击连线标签可直接编辑，未命名连线可双击“+”快速补充关系说明。",
      },
    ],
  },
  {
    title: "右侧节点面板",
    items: [
      {
        feature: "功能页：样式与重要度",
        usage: "可设置节点颜色，并通过滑块调整节点发出连线的重要度颜色（P0~P9）。",
      },
      {
        feature: "功能页：拖拽锁定",
        usage: "支持相邻/层级/传递三种锁定模式；锁定后拖动父节点会联动子节点移动。",
      },
      {
        feature: "功能页：自动整理",
        usage: "可选紧凑/平衡/宽松预设，支持发散/分层布局、间距与尝试次数调节，并可整理当前群组或全部群组。",
        tip: "已锁定节点在自动整理时会保持原位，整理后会提示估算交叉数。",
      },
      {
        feature: "内容页：富文本笔记",
        usage: "支持标题、标签、加粗、斜体、删除线、H1/H2/H3、有序/无序列表、代码块和引用。",
      },
    ],
  },
  {
    title: "左侧节点大纲",
    items: [
      {
        feature: "结构浏览",
        usage: "按连通群组展示节点，支持折叠/展开，并单独展示“未连接”节点。",
      },
      {
        feature: "统计筛选",
        usage: "可查看节点/连接总数、颜色分布、热门标签，并按颜色或标签一键筛选。",
      },
      {
        feature: "关系明细",
        usage: "每个节点可展开查看流入/流出连接明细，点击关系项可快速跳转并定位到对应节点。",
      },
    ],
  },
  {
    title: "布局与界面细节",
    items: [
      {
        feature: "面板宽度调节",
        usage: "主界面左右分栏支持拖拽改变宽度；双击分隔线可恢复默认宽度。",
      },
      {
        feature: "撤销与重做",
        usage: "支持多步历史回退/重做，适合试错式编辑与布局调优。",
      },
      {
        feature: "搜索定位",
        usage: "顶部搜索支持按标题/标签/内容检索，回车可快速跳转到首个命中节点。",
      },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsPanel: FC<KeyboardShortcutsPanelProps> = ({ isOpen, onClose }) => {
  const [isMac, setIsMac] = useState(false);
  const [activeTab, setActiveTab] = useState<"guide" | "shortcuts">("guide");
  const [guideQuery, setGuideQuery] = useState("");

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
      // 按 ? 键打开快捷键面板
      if (e.key === "?" && !isOpen) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formatKey = (key: string) => {
    if (isMac && key === "Ctrl") return "Cmd";
    return key;
  };

  const normalizedGuideQuery = guideQuery.trim().toLowerCase();
  const filteredGuideSections = useMemo<FilteredGuideSection[]>(() => {
    return guideSections
      .map((section, index) => {
        const filteredItems = section.items.filter((item) => {
          if (!normalizedGuideQuery) return true;
          const searchText = `${item.feature} ${item.usage} ${item.tip ?? ""}`.toLowerCase();
          return searchText.includes(normalizedGuideQuery);
        });

        return {
          id: `help-guide-section-${index}`,
          title: section.title,
          items: filteredItems,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [normalizedGuideQuery]);

  const totalGuideItemCount = useMemo(
    () => guideSections.reduce((count, section) => count + section.items.length, 0),
    [],
  );
  const filteredGuideItemCount = useMemo(
    () => filteredGuideSections.reduce((count, section) => count + section.items.length, 0),
    [filteredGuideSections],
  );

  const scrollToGuideSection = (sectionId: string) => {
    const sectionElement = document.getElementById(sectionId);
    if (sectionElement) {
      sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01" /><path d="M10 8h.01" /><path d="M14 8h.01" />
              <path d="M18 8h.01" /><path d="M6 12h.01" /><path d="M10 12h.01" />
              <path d="M14 12h.01" /><path d="M18 12h.01" /><path d="M6 16h12" />
            </svg>
            <span className="font-semibold text-text">帮助中心</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="px-5 py-3 border-b border-border bg-surface/20">
          <div className="inline-flex items-center rounded-lg bg-surface p-1 gap-1">
            <button
              onClick={() => setActiveTab("guide")}
              className={`px-3 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                activeTab === "guide"
                  ? "bg-white text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              功能指南
            </button>
            <button
              onClick={() => setActiveTab("shortcuts")}
              className={`px-3 py-1.5 text-xs rounded-md transition-all cursor-pointer ${
                activeTab === "shortcuts"
                  ? "bg-white text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              快捷键
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-5 max-h-[68vh] overflow-y-auto">
          {activeTab === "guide" && (
            <div className="space-y-5">
              <div className="space-y-3 rounded-lg border border-border bg-surface/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">目录与搜索</div>
                  <div className="text-xs text-text-muted">
                    显示 {filteredGuideItemCount} / {totalGuideItemCount} 项
                  </div>
                </div>

                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-white focus-within:ring-2 focus-within:ring-primary/15">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={guideQuery}
                    onChange={(e) => setGuideQuery(e.target.value)}
                    placeholder="搜索功能名称或用法，例如：批量编辑 / 导出 / 自动整理"
                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted/50"
                  />
                  {guideQuery && (
                    <button
                      onClick={() => setGuideQuery("")}
                      className="text-text-muted hover:text-text transition-colors cursor-pointer"
                      title="清空搜索"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {filteredGuideSections.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {filteredGuideSections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => scrollToGuideSection(section.id)}
                        className="px-2 py-1 text-xs rounded-md border border-border bg-white text-text-muted hover:text-text hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
                        title="跳转到该章节"
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredGuideSections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <div className="text-sm font-medium text-text">未找到匹配内容</div>
                  <div className="text-xs text-text-muted mt-1">请尝试更短关键词，例如“导出”“路径”“锁定”</div>
                  <button
                    onClick={() => setGuideQuery("")}
                    className="mt-3 px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text hover:bg-surface transition-colors cursor-pointer"
                  >
                    清空搜索
                  </button>
                </div>
              ) : (
                filteredGuideSections.map((section) => (
                  <div key={section.id} id={section.id}>
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      {section.title}
                    </h3>
                    <div className="space-y-2">
                      {section.items.map((item) => (
                        <div key={`${section.id}-${item.feature}`} className="rounded-lg border border-border bg-surface/20 px-3 py-2.5">
                          <div className="text-sm font-medium text-text">{item.feature}</div>
                          <div className="text-xs text-text-muted mt-1 leading-5">{item.usage}</div>
                          {item.tip && (
                            <div className="text-xs text-primary mt-1.5">提示：{item.tip}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "shortcuts" && (
            <>
              <div className="mb-5">
                <h3 className="text-xs font-medium text-text-muted mb-2">键盘快捷键</h3>
                <div className="space-y-2">
                  {shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm text-text">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={i}>
                            <kbd className="px-2 py-1 text-xs font-mono bg-surface border border-border rounded text-text-muted">
                              {formatKey(key)}
                            </kbd>
                            {i < shortcut.keys.length - 1 && (
                              <span className="text-text-muted mx-0.5">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-text-muted mb-2">鼠标操作</h3>
                <div className="space-y-2">
                  {mouseActions.map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm text-text">{item.description}</span>
                      <span className="text-xs text-text-muted bg-surface px-2 py-1 rounded">
                        {item.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-border bg-surface/50 text-center">
          <span className="text-xs text-text-muted">按 Escape 关闭</span>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsPanel;
