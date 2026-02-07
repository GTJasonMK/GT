import type { GraphData } from "@/types";
import { isTauri } from "@/platform/runtime";
import { openFileDialog, readTextFile, saveFileDialog, writeTextFile } from "@/platform/tauri";
import { deserializeGraphData, serializeGraphData } from "./graphStorage";
import { convertDrawnixToGraphData } from "./drawnixConvert";

function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickLocalFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function exportGraphAsJsonFile(data: GraphData, filename?: string): Promise<void> {
  const jsonStr = serializeGraphData(data);
  const defaultName = filename && filename.trim() ? filename.trim() : `graph_${Date.now()}.json`;

  if (isTauri()) {
    const filePath = await saveFileDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: defaultName,
    });
    if (!filePath) return;
    await writeTextFile(filePath, jsonStr);
    return;
  }

  downloadText(defaultName, jsonStr, "application/json");
}

export type ImportGraphSource = "graph" | "drawnix";

export interface ImportGraphResult {
  graph: GraphData;
  source: ImportGraphSource;
  warnings: string[];
}

function parseImportedGraph(text: string): ImportGraphResult | null {
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

/**
 * 导入图文件（支持本项目 JSON 与 Drawnix `.drawnix`）
 */
export async function importGraphFromFile(): Promise<ImportGraphResult | null> {
  if (isTauri()) {
    const filePath = await openFileDialog({
      filters: [
        { name: "Graph JSON", extensions: ["json"] },
        { name: "Drawnix", extensions: ["drawnix"] },
      ],
      multiple: false,
    });
    if (!filePath) return null;
    const text = await readTextFile(filePath);
    return parseImportedGraph(text);
  }

  const file = await pickLocalFile(".json,.drawnix");
  if (!file) return null;
  const text = await file.text();
  return parseImportedGraph(text);
}
