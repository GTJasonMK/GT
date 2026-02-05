import { isTauri } from "@/platform/runtime";
import { saveFileDialog, writeBinaryFile } from "@/platform/tauri";

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const [, base64] = dataUrl.split(",", 2);
  if (!base64) return new Uint8Array();

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function exportPngDataUrl(dataUrl: string): Promise<void> {
  const defaultName = `graph_${Date.now()}.png`;

  if (isTauri()) {
    const filePath = await saveFileDialog({
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      defaultPath: defaultName,
    });
    if (!filePath) return;
    const bytes = dataUrlToUint8Array(dataUrl);
    await writeBinaryFile(filePath, bytes);
    return;
  }

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = defaultName;
  a.click();
}

