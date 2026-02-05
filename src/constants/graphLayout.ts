/**
 * 图相关布局常量
 * 说明：
 * - 目前知识节点默认以约 120x50 的视觉尺寸渲染（见 KnowledgeNode）。
 * - 为了让“居中定位/创建节点”体验一致，这里统一使用中心偏移。
 */

export const NODE_CENTER_OFFSET = { x: 60, y: 25 } as const;

export const FOCUS_NODE_ZOOM = 1.2;
export const FOCUS_NODE_DURATION_MS = 500;

