import { create } from "zustand";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  createdAt: number;
  durationMs: number;
}

interface ToastStore {
  toasts: ToastItem[];
  pushToast: (toast: Omit<ToastItem, "id" | "createdAt">) => number;
  dismissToast: (id: number) => void;
  clearToasts: () => void;
}

let nextToastId = 1;
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  pushToast: (toast) => {
    const id = nextToastId++;
    const createdAt = Date.now();
    const durationMs = Number.isFinite(toast.durationMs) && toast.durationMs > 0 ? toast.durationMs : 2600;

    set((state) => ({
      toasts: [...state.toasts, { ...toast, id, createdAt, durationMs }],
    }));

    const timer = setTimeout(() => {
      get().dismissToast(id);
    }, durationMs);
    dismissTimers.set(id, timer);

    return id;
  },

  dismissToast: (id) => {
    const timer = dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },

  clearToasts: () => {
    dismissTimers.forEach((timer) => clearTimeout(timer));
    dismissTimers.clear();
    set({ toasts: [] });
  },
}));

// 便捷方法：避免到处引入 store hook
export const toast = {
  info: (message: string, options?: { title?: string; durationMs?: number }) =>
    useToastStore.getState().pushToast({ type: "info", message, title: options?.title, durationMs: options?.durationMs ?? 2400 }),
  success: (message: string, options?: { title?: string; durationMs?: number }) =>
    useToastStore.getState().pushToast({ type: "success", message, title: options?.title, durationMs: options?.durationMs ?? 2200 }),
  warning: (message: string, options?: { title?: string; durationMs?: number }) =>
    useToastStore.getState().pushToast({ type: "warning", message, title: options?.title, durationMs: options?.durationMs ?? 3200 }),
  error: (message: string, options?: { title?: string; durationMs?: number }) =>
    useToastStore.getState().pushToast({ type: "error", message, title: options?.title, durationMs: options?.durationMs ?? 3600 }),
};

