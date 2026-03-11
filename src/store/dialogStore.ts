import { create } from "zustand";

export type DialogDescriptor =
  | {
      id: number;
      kind: "alert";
      title: string;
      message: string;
      confirmText?: string;
    }
  | {
      id: number;
      kind: "confirm";
      title: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }
  | {
      id: number;
      kind: "prompt";
      title: string;
      message?: string;
      placeholder?: string;
      defaultValue?: string;
      confirmText?: string;
      cancelText?: string;
    };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type DialogDraft = DistributiveOmit<DialogDescriptor, "id">;

interface DialogStore {
  dialog: DialogDescriptor | null;
  setDialog: (dialog: DialogDescriptor | null) => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  dialog: null,
  setDialog: (dialog) => set({ dialog }),
}));

let nextDialogId = 1;
const resolvers = new Map<number, (value: unknown) => void>();

function openDialog<T>(dialog: DialogDraft): Promise<T> {
  const id = nextDialogId++;
  return new Promise<T>((resolve) => {
    resolvers.set(id, resolve as (value: unknown) => void);
    useDialogStore.getState().setDialog({ ...dialog, id } as DialogDescriptor);
  });
}

export function resolveDialog(id: number, value: unknown) {
  const resolver = resolvers.get(id);
  resolvers.delete(id);
  const current = useDialogStore.getState().dialog;
  if (current?.id === id) {
    useDialogStore.getState().setDialog(null);
  }
  resolver?.(value);
}

export function cancelActiveDialog() {
  const current = useDialogStore.getState().dialog;
  if (!current) return;
  if (current.kind === "confirm") resolveDialog(current.id, false);
  if (current.kind === "prompt") resolveDialog(current.id, null);
  if (current.kind === "alert") resolveDialog(current.id, undefined);
}

// 对外 API：尽量贴近原生 alert/confirm/prompt 的语义（但不阻塞线程）
export function openAlert(options: { title?: string; message: string; confirmText?: string }): Promise<void> {
  return openDialog<void>({
    kind: "alert",
    title: options.title || "提示",
    message: options.message,
    confirmText: options.confirmText || "知道了",
  });
}

export function openConfirm(options: {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return openDialog<boolean>({
    kind: "confirm",
    title: options.title || "确认",
    message: options.message,
    confirmText: options.confirmText || "确认",
    cancelText: options.cancelText || "取消",
    danger: options.danger,
  });
}

export function openPrompt(options: {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<string | null> {
  return openDialog<string | null>({
    kind: "prompt",
    title: options.title || "请输入",
    message: options.message,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    confirmText: options.confirmText || "确定",
    cancelText: options.cancelText || "取消",
  });
}
