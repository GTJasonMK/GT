import type { GraphData } from "../types/index.ts";

export type ImportGraphSource = "graph" | "drawnix";

export interface ParsedImportedGraphData {
  graph: GraphData;
  source: ImportGraphSource;
  warnings: string[];
}

export interface ImportGraphSuccessResult extends ParsedImportedGraphData {
  status: "success";
}

export type ImportGraphFromFileResult =
  | ImportGraphSuccessResult
  | { status: "cancelled" }
  | { status: "invalid" };

interface FileDialogFilter {
  name: string;
  extensions: string[];
}

interface OpenFileDialogOptions {
  filters?: FileDialogFilter[];
  multiple?: boolean;
}

type FileListLike<TFile> = ArrayLike<TFile | null | undefined>;

interface FileInputLike<TFile> {
  type: string;
  accept: string;
  files: FileListLike<TFile> | null;
  onchange: null | (() => void);
  click(): void;
  remove?: () => void;
}

interface PickLocalFileDeps<TFile> {
  createInput?: () => FileInputLike<TFile>;
  appendInput?: (input: FileInputLike<TFile>) => void;
  addWindowFocusListener?: (handler: () => void) => void;
  removeWindowFocusListener?: (handler: () => void) => void;
  schedule?: (callback: () => void, delayMs: number) => number;
  cancelScheduled?: (handle: number) => void;
}

interface TextReadableFileLike {
  text(): Promise<string>;
}

export interface ImportGraphFromFileDeps<TFile extends TextReadableFileLike = File> {
  isTauri: () => boolean;
  openFileDialog: (options: OpenFileDialogOptions) => Promise<string | null>;
  readTextFile: (filePath: string) => Promise<string>;
  pickLocalFile: (accept: string) => Promise<TFile | null>;
  parseText?: (text: string) => ParsedImportedGraphData | null;
}

const FILE_DIALOG_CANCEL_CHECK_DELAY_MS = 300;
const IMPORT_FILE_ACCEPT = ".json,.drawnix";
const IMPORT_FILE_DIALOG_FILTERS = [
  { name: "Graph JSON", extensions: ["json"] },
  { name: "Drawnix", extensions: ["drawnix"] },
] satisfies FileDialogFilter[];

function isGraphData(value: unknown): value is GraphData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

function defaultParseGraphFileText(text: string): ParsedImportedGraphData | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isGraphData(parsed)) {
      return null;
    }
    return {
      graph: parsed,
      source: "graph",
      warnings: [],
    };
  } catch {
    return null;
  }
}

function getFirstFile<TFile>(files: FileListLike<TFile> | null): TFile | null {
  return files?.[0] ?? null;
}

function createDefaultFileInput<TFile>(): FileInputLike<TFile> {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器文件选择。");
  }
  const input = document.createElement("input");
  input.style.display = "none";
  return input as unknown as FileInputLike<TFile>;
}

function appendDefaultInput<TFile>(input: FileInputLike<TFile>) {
  if (typeof document === "undefined") return;
  document.body?.appendChild(input as unknown as Node);
}

function addDefaultWindowFocusListener(handler: () => void) {
  if (typeof window === "undefined") return;
  window.addEventListener("focus", handler);
}

function removeDefaultWindowFocusListener(handler: () => void) {
  if (typeof window === "undefined") return;
  window.removeEventListener("focus", handler);
}

function defaultSchedule(callback: () => void, delayMs: number): number {
  if (typeof window === "undefined") {
    callback();
    return 0;
  }
  return window.setTimeout(callback, delayMs);
}

function defaultCancelScheduled(handle: number) {
  if (typeof window === "undefined") return;
  window.clearTimeout(handle);
}

export function pickLocalFile<TFile = File>(
  accept: string,
  deps: PickLocalFileDeps<TFile> = {},
): Promise<TFile | null> {
  const createInput = deps.createInput ?? createDefaultFileInput<TFile>;
  const appendInput = deps.appendInput ?? appendDefaultInput;
  const addWindowFocusListener = deps.addWindowFocusListener ?? addDefaultWindowFocusListener;
  const removeWindowFocusListener = deps.removeWindowFocusListener ?? removeDefaultWindowFocusListener;
  const schedule = deps.schedule ?? defaultSchedule;
  const cancelScheduled = deps.cancelScheduled ?? defaultCancelScheduled;
  const input = createInput();

  input.type = "file";
  input.accept = accept;
  appendInput(input);

  return new Promise((resolve) => {
    let settled = false;
    let scheduledHandle: number | null = null;

    const cleanup = () => {
      if (scheduledHandle !== null) {
        cancelScheduled(scheduledHandle);
      }
      removeWindowFocusListener(handleWindowFocus);
      input.onchange = null;
      input.remove?.();
    };

    const finish = (file: TFile | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };

    // 文件选择取消时通常不会触发 change，这里在窗口重新聚焦后主动判断一次。
    const handleWindowFocus = () => {
      scheduledHandle = schedule(() => {
        if (getFirstFile(input.files) === null) {
          finish(null);
        }
      }, FILE_DIALOG_CANCEL_CHECK_DELAY_MS);
    };

    input.onchange = () => {
      finish(getFirstFile(input.files));
    };

    addWindowFocusListener(handleWindowFocus);
    input.click();
  });
}

function toImportResult(parsed: ParsedImportedGraphData | null): ImportGraphFromFileResult {
  if (!parsed) {
    return { status: "invalid" };
  }
  return {
    status: "success",
    ...parsed,
  };
}

export async function importGraphFromFile<TFile extends TextReadableFileLike = File>(
  deps: ImportGraphFromFileDeps<TFile>,
): Promise<ImportGraphFromFileResult> {
  const parseText = deps.parseText ?? defaultParseGraphFileText;

  if (deps.isTauri()) {
    const filePath = await deps.openFileDialog({
      filters: IMPORT_FILE_DIALOG_FILTERS,
      multiple: false,
    });
    if (!filePath) {
      return { status: "cancelled" };
    }
    const text = await deps.readTextFile(filePath);
    return toImportResult(parseText(text));
  }

  const file = await deps.pickLocalFile(IMPORT_FILE_ACCEPT);
  if (!file) {
    return { status: "cancelled" };
  }
  const text = await file.text();
  return toImportResult(parseText(text));
}
