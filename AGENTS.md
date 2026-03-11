# Repository Guidelines

## 项目结构与模块组织

- `src/`：前端 UI（Vite + React + TypeScript）。主要目录：`src/components/`、`src/hooks/`、`src/store/`（Zustand）、`src/services/`、`src/types/`。
- `src-tauri/`：Tauri 2 桌面端（Rust）与配置（`src-tauri/tauri.conf.json`）。持久化逻辑见 `src-tauri/src/lib.rs`。
- `docs/`：项目文档（例如 `docs/graph-json-format.md`）。
- 构建产物：`dist/`、`src-tauri/target/`（不要手工修改或提交）。

## 构建、测试与开发命令

- `npm install`：安装依赖。
- `npm run dev`：仅启动前端（Vite dev server）。
- `npm run dev:app`（或 `npm run tauri -- dev` / `npm run start`）：启动桌面端（需要 Rust 工具链）。
- `npm run build`：类型检查（`tsc -b`）+ 前端构建（`vite build`）。
- `npm run build:app`：构建 Tauri 桌面端产物。
- `npm run preview`：本地预览生产构建。
- `install.bat`：Windows 一键安装依赖（创建 `.venv` + 安装 uv + 安装 npm 依赖）。
- `start.bat`：Windows 一键启动（自动找可用端口；`start.bat web` / `start.bat app`）。
- `build.bat`：Windows 一键打包（`build.bat web` / `build.bat app`，可加 `clean` 清理产物）。

## 代码风格与命名约定

- TypeScript 开启 `strict`，并启用 `noUnusedLocals`/`noUnusedParameters`；保证 `npm run build` 无告警。
- 风格：2 空格缩进、双引号（`"`）、分号（`;`）。
- 命名：组件 `PascalCase.tsx`（如 `GraphCanvas.tsx`），Hooks 使用 `useX.ts`，状态集中在 `src/store/`。
- 导入：优先使用 `@/` 别名（如 `import { useGraphStore } from "@/store/graphStore";`）。
- 代码注释使用中文，说明意图与约束。

## 测试指南

- 当前未配置 JS 单元测试：请至少运行 `npm run build`，并做手动冒烟（画布渲染、增删/编辑节点、导入/导出、保存/加载）。
- 修改 Rust 端：在 `src-tauri/` 下运行 `cargo test`（如适用），并确认 `npm run tauri -- dev` 可正常启动。

## 数据与配置提示

- Web 端持久化使用浏览器 `localStorage`；桌面端持久化写入系统应用数据目录下的 `GraphAndTable/graph_data.json`（见 `src-tauri/src/lib.rs`）。
- 导入/导出 JSON 字段约定见 `docs/graph-json-format.md`。

## 提交与 Pull Request 规范

- Git 历史以简短中文动词短语为主（如“优化… / 添加… / 清理…”）；建议保持单一主题，必要时补充影响范围。
- PR 至少包含：变更说明（what/why）、本地验证步骤（Web/Tauri）、UI 改动截图；涉及 `src-tauri/` 时注明 OS 与 Rust 版本。
