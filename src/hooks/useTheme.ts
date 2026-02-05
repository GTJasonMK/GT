import { useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark";

const THEME_KEY = "graph-and-table-theme";

/**
 * 主题管理 Hook
 * 支持浅色/深色模式切换，持久化到 localStorage
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // 优先使用保存的主题
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    // 否则使用系统偏好
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });

  // 应用主题到 HTML 元素
  useEffect(() => {
    const html = document.documentElement;
    if (theme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // 切换主题
  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  return { theme, toggleTheme, setTheme };
}
