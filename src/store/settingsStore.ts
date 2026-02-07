import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LayoutStyle } from "@/lib/graphAutoLayout";

interface CanvasSettings {
  panSpeed: number; // WASD 平移速度（像素/帧）
  zoomFactor: number; // 缩放因子（每次缩放的倍率，如 1.2 = 20%）
}

interface PanelSettings {
  leftPanelWidth: number; // 左侧面板宽度（像素）
  rightPanelWidth: number; // 右侧面板宽度（像素）
}

interface LayoutSettings {
  layoutStyle: LayoutStyle; // 自动整理布局风格
  includeOtherComponents: boolean; // 是否同时整理其它不连通分量
  ringSpacing: number; // 层间距（像素）
  nodeSpacing: number; // 同层间距（像素）
  maxAttempts: number; // 随机尝试次数（越大越慢但交叉可能更少）
  confirmBeforeGlobalLayout: boolean; // 全局整理前是否弹窗确认
  globalEdgeFlowAnimation: boolean; // 是否全局显示连线流向动画
}

interface SettingsStore {
  canvas: CanvasSettings;
  panel: PanelSettings;
  layout: LayoutSettings;
  setCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  setPanelSettings: (settings: Partial<PanelSettings>) => void;
  setLayoutSettings: (settings: Partial<LayoutSettings>) => void;
  resetCanvasSettings: () => void;
  resetPanelSettings: () => void;
  resetLayoutSettings: () => void;
}

const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  panSpeed: 12,
  zoomFactor: 1.2,
};

const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  leftPanelWidth: 224, // 原来的 w-56 = 14rem = 224px
  rightPanelWidth: 320, // 原来的 w-80 = 20rem = 320px
};

const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  layoutStyle: "radial",
  includeOtherComponents: false,
  ringSpacing: 140,
  nodeSpacing: 140,
  maxAttempts: 12,
  confirmBeforeGlobalLayout: true,
  globalEdgeFlowAnimation: false,
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
      layout: DEFAULT_LAYOUT_SETTINGS,

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

      setLayoutSettings: (settings) => {
        set((state) => ({
          layout: { ...state.layout, ...settings },
        }));
      },

      resetCanvasSettings: () => {
        set({ canvas: DEFAULT_CANVAS_SETTINGS });
      },

      resetPanelSettings: () => {
        set({ panel: DEFAULT_PANEL_SETTINGS });
      },

      resetLayoutSettings: () => {
        set({ layout: DEFAULT_LAYOUT_SETTINGS });
      },
    }),
    {
      name: "graph-and-table-settings",
    },
  ),
);
