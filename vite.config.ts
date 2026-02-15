import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

function resolveManualChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("@xyflow/react")) {
    return "graph-vendor";
  }

  if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("orderedmap")) {
    return "editor-vendor";
  }

  if (id.includes("@tauri-apps")) {
    return "tauri-vendor";
  }

  if (id.includes("html-to-image")) {
    return "image-vendor";
  }

  return "vendor";
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
  // Tauri 开发服务器配置
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
