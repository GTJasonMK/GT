import { useEffect, useMemo, useState } from "react";
import { cancelActiveDialog, resolveDialog, useDialogStore } from "@/store/dialogStore";

export default function DialogHost() {
  const dialog = useDialogStore((s) => s.dialog);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === "prompt") {
      setInput(dialog.defaultValue ?? "");
    } else {
      setInput("");
    }
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelActiveDialog();
      }
      if (e.key === "Enter" && dialog.kind === "prompt") {
        // 避免在多行输入场景误提交：这里 prompt 仅用 input（不是 textarea）
        e.preventDefault();
        resolveDialog(dialog.id, input);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, input]);

  const buttons = useMemo(() => {
    if (!dialog) return null;
    if (dialog.kind === "alert") {
      return [
        {
          key: "ok",
          label: dialog.confirmText || "知道了",
          kind: "primary" as const,
          onClick: () => resolveDialog(dialog.id, undefined),
        },
      ];
    }

    if (dialog.kind === "confirm") {
      return [
        {
          key: "cancel",
          label: dialog.cancelText || "取消",
          kind: "ghost" as const,
          onClick: () => resolveDialog(dialog.id, false),
        },
        {
          key: "confirm",
          label: dialog.confirmText || "确认",
          kind: dialog.danger ? ("danger" as const) : ("primary" as const),
          onClick: () => resolveDialog(dialog.id, true),
        },
      ];
    }

    if (dialog.kind === "prompt") {
      return [
        {
          key: "cancel",
          label: dialog.cancelText || "取消",
          kind: "ghost" as const,
          onClick: () => resolveDialog(dialog.id, null),
        },
        {
          key: "confirm",
          label: dialog.confirmText || "确定",
          kind: "primary" as const,
          onClick: () => resolveDialog(dialog.id, input),
        },
      ];
    }

    return null;
  }, [dialog, input]);

  if (!dialog) return null;

  const title = dialog.title;
  const message = dialog.kind === "prompt" ? dialog.message : dialog.message;
  const showInput = dialog.kind === "prompt";

  return (
    <div className="fixed inset-0 z-[110] bg-black/45 flex items-center justify-center px-4" onClick={() => cancelActiveDialog()}>
      <div
        className="w-full max-w-md bg-white border border-border rounded-xl shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text">{title}</div>
            {message && <div className="mt-1 text-sm text-text-muted leading-snug whitespace-pre-wrap">{message}</div>}
          </div>
          <button
            className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
            onClick={() => cancelActiveDialog()}
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {showInput && (
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={dialog.placeholder || ""}
            className="mt-2 w-full px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary/20"
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          {buttons?.map((btn) => {
            const base =
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer";
            const cls =
              btn.kind === "primary"
                ? `${base} bg-primary text-white hover:bg-primary-dark`
                : btn.kind === "danger"
                  ? `${base} bg-red-600 text-white hover:bg-red-700`
                  : `${base} border border-border hover:bg-surface text-text-muted hover:text-text`;

            return (
              <button key={btn.key} onClick={btn.onClick} className={cls}>
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

