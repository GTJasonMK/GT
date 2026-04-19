import type { GraphWorkspaceExportFileOptions } from "@/agent/types.ts";
import type { GraphData } from "@/types";
import { isTauri } from "@/platform/runtime";
import { openFileDialog, readTextFile, saveFileDialog, writeTextFile } from "@/platform/tauri";
import { deserializeGraphData, serializeGraphData } from "./graphStorage";
import { convertDrawnixToGraphData } from "./drawnixConvert";
import {
  importGraphFromFile as importGraphFromFileCore,
  pickLocalFile as pickLocalFileCore,
  type ImportGraphFromFileResult,
  type ParsedImportedGraphData,
} from "./graphFileTransferCore";

const GRAPH_EXPORT_MIME = "application/json";
const GRAPH_EXPORT_FILTERS = [{ name: "JSON", extensions: ["json"] }];
const DEFAULT_GRAPH_EXPORT_BASENAME = "graph";
const EXPORT_DIALOG_CANCELLED_ERROR = "导出已取消。";

function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

function resolveGraphExportFilename(filename?: string): string {
  const normalizedFilename = filename?.trim();
  if (normalizedFilename) {
    return normalizedFilename;
  }
  return `${DEFAULT_GRAPH_EXPORT_BASENAME}_${Date.now()}.json`;
}

export type ImportGraphResult = ParsedImportedGraphData;

export type GraphJsonOutputPathResult =
  | { status: "selected"; outputPath: string }
  | { status: "cancelled" }
  | { status: "not_needed" };

export async function requestGraphJsonOutputPath(filename?: string): Promise<GraphJsonOutputPathResult> {
  if (!isTauri()) {
    return { status: "not_needed" };
  }

  const filePath = await saveFileDialog({
    filters: GRAPH_EXPORT_FILTERS,
    defaultPath: resolveGraphExportFilename(filename),
  });
  if (!filePath) {
    return { status: "cancelled" };
  }
  return {
    status: "selected",
    outputPath: filePath,
  };
}

export async function exportGraphAsJsonFile(
  data: GraphData,
  options: GraphWorkspaceExportFileOptions = {},
): Promise<void> {
  const jsonStr = serializeGraphData(data);
  const defaultName = resolveGraphExportFilename(options.filename);

  if (isTauri()) {
    const explicitOutputPath = options.outputPath?.trim();
    if (explicitOutputPath) {
      await writeTextFile(explicitOutputPath, jsonStr);
      return;
    }

    const outputPathResult = await requestGraphJsonOutputPath(options.filename);
    if (outputPathResult.status !== "selected") {
      throw new Error(EXPORT_DIALOG_CANCELLED_ERROR);
    }
    await writeTextFile(outputPathResult.outputPath, jsonStr);
    return;
  }

  downloadText(defaultName, jsonStr, GRAPH_EXPORT_MIME);
}

export function parseGraphFileText(text: string): ParsedImportedGraphData | null {
  const graph = deserializeGraphData(text);
  if (graph) return { graph, source: "graph", warnings: [] };

  try {
    const parsed = JSON.parse(text) as unknown;
    const converted = convertDrawnixToGraphData(parsed);
    if (!converted) return null;
    return { graph: converted.graph, source: "drawnix", warnings: converted.report.warnings };
  } catch {
    return null;
  }
}

export async function importGraphFromFile(): Promise<ImportGraphFromFileResult> {
  return importGraphFromFileCore({
    isTauri,
    openFileDialog,
    readTextFile,
    pickLocalFile: (accept) => pickLocalFileCore(accept),
    parseText: parseGraphFileText,
  });
}
