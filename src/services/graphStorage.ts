import type { GraphData } from "@/types";
import { isTauri } from "@/platform/runtime";
import { invokeTauri } from "@/platform/tauri";

const LOCAL_STORAGE_KEY = "graph_data";

function isGraphData(value: unknown): value is GraphData {
  if (!value || typeof value !== "object") return false;
  const v = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return false;
  return true;
}

export function serializeGraphData(data: GraphData): string {
  return JSON.stringify(data);
}

export function deserializeGraphData(jsonStr: string): GraphData | null {
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!isGraphData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveGraphData(data: GraphData): Promise<void> {
  const jsonStr = serializeGraphData(data);
  if (isTauri()) {
    await invokeTauri("save_graph_data", { data: jsonStr });
    return;
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, jsonStr);
}

export async function loadGraphData(): Promise<GraphData | null> {
  let jsonStr: string | null = null;
  if (isTauri()) {
    jsonStr = await invokeTauri<string>("load_graph_data");
  } else {
    jsonStr = localStorage.getItem(LOCAL_STORAGE_KEY);
  }

  if (!jsonStr || jsonStr === "{}") return null;
  return deserializeGraphData(jsonStr);
}

