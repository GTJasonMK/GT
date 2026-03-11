import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 全局 UI 状态
 * - 命令面板 / 快捷键帮助 / 设置面板等，需要跨组件触发
 */
const RECENT_NODE_LIMIT = 12;
const RECENT_COMMAND_LIMIT = 12;

interface UiStore {
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;

  recentNodeIds: string[];
  recentCommandIds: string[];

  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  pushRecentNode: (nodeId: string) => void;
  pushRecentCommand: (commandId: string) => void;
  clearRecents: () => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      commandPaletteOpen: false,
      shortcutsOpen: false,
      settingsOpen: false,

      recentNodeIds: [],
      recentCommandIds: [],

      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      pushRecentNode: (nodeId) => {
        const current = get().recentNodeIds;
        const next = [nodeId, ...current.filter((id) => id !== nodeId)].slice(0, RECENT_NODE_LIMIT);
        set({ recentNodeIds: next });
      },

      pushRecentCommand: (commandId) => {
        const current = get().recentCommandIds;
        const next = [commandId, ...current.filter((id) => id !== commandId)].slice(0, RECENT_COMMAND_LIMIT);
        set({ recentCommandIds: next });
      },

      clearRecents: () => set({ recentNodeIds: [], recentCommandIds: [] }),
    }),
    {
      name: "graph-and-table-ui",
      partialize: (state) => ({
        recentNodeIds: state.recentNodeIds,
        recentCommandIds: state.recentCommandIds,
      }),
    },
  ),
);
