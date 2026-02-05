import { memo, useEffect, useRef, type FC } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
  color?: string; // 菜单项前的颜色指示器
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 右键上下文菜单组件
 */
const ContextMenu: FC<ContextMenuProps> = memo(({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟绑定，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // 确保菜单不超出视口
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-white rounded-lg shadow-lg border border-border py-1 animate-in fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={index} className="h-px bg-border my-1" />;
        }
        return (
          <button
            key={index}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 cursor-pointer transition-colors duration-100
              ${item.danger
                ? "text-red-500 hover:bg-red-50"
                : "text-text hover:bg-surface"
              }
            `}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.color && (
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
});

ContextMenu.displayName = "ContextMenu";

export default ContextMenu;
