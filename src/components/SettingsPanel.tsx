import { useEffect, type FC } from "react";
import { useSettingsStore } from "@/store/settingsStore";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsPanel: FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const canvasSettings = useSettingsStore((s) => s.canvas);
  const setCanvasSettings = useSettingsStore((s) => s.setCanvasSettings);
  const resetCanvasSettings = useSettingsStore((s) => s.resetCanvasSettings);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="font-semibold text-text">设置</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text hover:bg-surface rounded transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-5">
          {/* 画布交互设置 */}
          <div>
            <h3 className="text-xs font-medium text-text-muted mb-3">画布交互</h3>
            <div className="space-y-4">
              {/* 平移速度 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-text">平移速度</label>
                  <span className="text-xs text-text-muted bg-surface px-2 py-1 rounded font-mono">
                    {canvasSettings.panSpeed}
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="80"
                  step="2"
                  value={canvasSettings.panSpeed}
                  onChange={(e) => setCanvasSettings({ panSpeed: Number(e.target.value) })}
                  className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-text-muted mt-1">
                  <span>慢</span>
                  <span>快</span>
                </div>
              </div>

              {/* 缩放幅度 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-text">缩放幅度</label>
                  <span className="text-xs text-text-muted bg-surface px-2 py-1 rounded font-mono">
                    {Math.round((canvasSettings.zoomFactor - 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="1.02"
                  max="2.5"
                  step="0.02"
                  value={canvasSettings.zoomFactor}
                  onChange={(e) => setCanvasSettings({ zoomFactor: Number(e.target.value) })}
                  className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-text-muted mt-1">
                  <span>细腻</span>
                  <span>粗犷</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-border bg-surface/50 flex items-center justify-between">
          <button
            onClick={resetCanvasSettings}
            className="text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            恢复默认
          </button>
          <span className="text-xs text-text-muted">按 Escape 关闭</span>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
