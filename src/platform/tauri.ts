import type { OpenDialogOptions, SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./runtime";

/**
 * Tauri 调用封装
 * - 使用动态 import，避免 Web 环境打包/运行时报错
 * - 统一“是否在 Tauri 中运行”的判断逻辑
 */

export async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("当前不在 Tauri 环境中运行");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function openFileDialog(options: OpenDialogOptions): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open(options);
  if (typeof result === "string") return result;
  return null;
}

export async function saveFileDialog(options: SaveDialogOptions): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save(options);
  if (typeof result === "string") return result;
  return null;
}

export async function readTextFile(filePath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("readTextFile 仅支持在 Tauri 环境中调用");
  }
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(filePath);
}

export async function writeTextFile(filePath: string, contents: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("writeTextFile 仅支持在 Tauri 环境中调用");
  }
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(filePath, contents);
}

export async function writeBinaryFile(filePath: string, contents: Uint8Array): Promise<void> {
  if (!isTauri()) {
    throw new Error("writeBinaryFile 仅支持在 Tauri 环境中调用");
  }
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(filePath, contents);
}

