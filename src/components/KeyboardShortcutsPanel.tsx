import { useEffect, useState, type FC } from "react";

interface ShortcutItem {
  keys: string[];
  description: string;
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

interface KeyboardShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsPanel: FC<KeyboardShortcutsPanelProps> = ({ isOpen, onClose }) => {
  const [isMac, setIsMac] = useState(false);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden"
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
            <span className="font-semibold text-text">快捷键</span>
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

        {/* 内容 */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {/* 键盘快捷键 */}
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

          {/* 鼠标操作 */}
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
