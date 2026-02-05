# Repository Guidelines

本仓库为基于 Vite + React 的知识图谱编辑器，配套 Tauri 2 桌面端（Rust）。

## 项目结构与模块组织

- `src/`：前端 UI（TypeScript + React）。主要目录：`components/`、`hooks/`、`store/`（Zustand）、`types/`。
- `src-tauri/`：Tauri 后端与打包配置（`Cargo.toml`、`tauri.conf.json`）。
- `scripts/`：Windows 本地开发/构建脚本（`dev.ps1`/`dev.cmd`、`build.ps1`/`build.cmd`）。
- `dist/`、`src-tauri/target/`：构建产物（不要手工修改）。

## 本地开发、构建与常用命令

- `npm install`：安装前端依赖。
- `npm run dev`：仅启动前端（默认端口 `1420`）。
- `npm run dev:app`（或 `npm run tauri dev` / `npm run start`）：启动桌面端（需要 Rust 工具链）。
- `npm run build`：`tsc -b` + `vite build`（产物在 `dist/`）。
- `npm run preview`：本地预览生产构建。
- Windows 便捷入口：`.\scripts\dev.ps1`、`.\scripts\build.ps1`。

## 代码风格与命名约定

- TypeScript 采用 `strict`（见 `tsconfig.json`），保持 `tsc` 无告警（未使用变量/参数等）。
- 组件文件用 `PascalCase`（如 `GraphCanvas.tsx`）；Hooks 用 `useX`（如 `useTheme.ts`）。
- 优先使用 `@/` 路径别名导入（见 `tsconfig.json`、`vite.config.ts`）。
- 跟随现有风格：2 空格缩进、双引号、分号；代码注释使用中文。

## 测试与验证

- 当前未配置 JS 单测框架；合入前至少运行 `npm run build`，并做手动冒烟（画布渲染、增删/编辑节点、保存/加载）。
- 修改 Rust 端：在 `src-tauri/` 下执行 `cargo test`（如有），并确认 `npm run tauri dev` 可正常启动。

## 架构提示（可选）

- UI 状态集中在 `src/store/`；图编辑基于 `@xyflow/react`。
- 数据持久化在 `src-tauri/src/lib.rs`：`save_graph_data`/`load_graph_data` 读写 `graph_data.json`（系统应用数据目录）。

## 提交与 PR 规范

- 本工作区未包含 Git 历史；默认建议 Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:`。
- PR 需包含：变更摘要、验证步骤（Web/Tauri）、UI 截图；涉及 `src-tauri/` 时注明测试的 OS/版本。
