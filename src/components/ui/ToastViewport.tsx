import { useCallback, type ReactNode } from "react";
import { useToastStore, type ToastItem } from "@/store/toastStore";

function typeStyles(type: ToastItem["type"]): { ring: string; icon: ReactNode } {
  switch (type) {
    case "success":
      return {
        ring: "ring-green-500/20",
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ),
      };
    case "warning":
      return {
        ring: "ring-amber-500/25",
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        ),
      };
    case "error":
      return {
        ring: "ring-red-500/25",
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6" />
            <path d="M9 9l6 6" />
          </svg>
        ),
      };
    default:
      return {
        ring: "ring-primary/25",
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        ),
      };
  }
}

/**
 * 全局 Toast 容器
 * - 固定定位，不占用布局
 * - 自动消失（由 store 负责 timer）
 */
export default function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  const handleDismiss = useCallback(
    (id: number) => {
      dismissToast(id);
    },
    [dismissToast],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-[100] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-24px)]">
      {toasts.map((item) => {
        const styles = typeStyles(item.type);
        return (
          <button
            key={item.id}
            onClick={() => handleDismiss(item.id)}
            className={`text-left bg-white border border-border rounded-xl shadow-md px-3 py-2.5 cursor-pointer transition-all duration-150 hover:shadow-lg active:scale-[0.99] ring-2 ${styles.ring}`}
            title="点击关闭"
          >
            <div className="flex items-start gap-2">
              <div className="text-text-muted mt-0.5">{styles.icon}</div>
              <div className="min-w-0 flex-1">
                {item.title && <div className="text-xs font-semibold text-text mb-0.5">{item.title}</div>}
                <div className="text-sm text-text leading-snug break-words">{item.message}</div>
              </div>
              <div className="text-text-muted/70">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
