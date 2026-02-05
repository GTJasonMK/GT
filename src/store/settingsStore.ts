import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CanvasSettings {
  panSpeed: number; // WASD 平移速度（像素/帧）
  zoomFactor: number; // 缩放因子（每次缩放的倍率，如 1.2 = 20%）
}

interface PanelSettings {
  leftPanelWidth: number; // 左侧面板宽度（像素）
  rightPanelWidth: number; // 右侧面板宽度（像素）
}

interface SettingsStore {
  canvas: CanvasSettings;
  panel: PanelSettings;
  setCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  setPanelSettings: (settings: Partial<PanelSettings>) => void;
  resetCanvasSettings: () => void;
  resetPanelSettings: () => void;
}

const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  panSpeed: 12,
  zoomFactor: 1.2,
};

const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  leftPanelWidth: 224, // 原来的 w-56 = 14rem = 224px
  rightPanelWidth: 320, // 原来的 w-80 = 20rem = 320px
};

// 面板宽度限制
export const PANEL_WIDTH_LIMITS = {
  left: { min: 160, max: 400 },
  right: { min: 240, max: 600 },
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      canvas: DEFAULT_CANVAS_SETTINGS,
      panel: DEFAULT_PANEL_SETTINGS,

      setCanvasSettings: (settings) => {
        set((state) => ({
          canvas: { ...state.canvas, ...settings },
        }));
      },

      setPanelSettings: (settings) => {
        set((state) => ({
          panel: { ...state.panel, ...settings },
        }));
      },

      resetCanvasSettings: () => {
        set({ canvas: DEFAULT_CANVAS_SETTINGS });
      },

      resetPanelSettings: () => {
        set({ panel: DEFAULT_PANEL_SETTINGS });
      },
    }),
    {
      name: "graph-and-table-settings",
    },
  ),
);
