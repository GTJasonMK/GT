import type { KnowledgeNodeData, KnowledgeEdgeData, NodeColor } from "@/types";

// 边的基础类型（兼容 ReactFlow Edge 类型）
type EdgeLike = {
  id: string;
  source: string;
  target: string;
  data?: KnowledgeEdgeData | Record<string, unknown>;
  label?: string | React.ReactNode;
};

// 边连接信息（包含边的详细数据）
export interface EdgeConnection {
  nodeId: string; // 连接的节点ID
  edgeId: string; // 边的ID
  label?: string; // 边的标签
  relation?: KnowledgeEdgeData["relation"]; // 边的关系类型
}

export interface ConnectionInfo {
  outgoing: EdgeConnection[]; // 出边（连接到的节点）
  incoming: EdgeConnection[]; // 入边（来自的节点）
}

export type ConnectionInfoMap = Record<string, ConnectionInfo>;

export interface NodeGroup {
  /**
   * 稳定的群组标识（使用该连通分量内最小的节点 id）
   * 用于在节点/边变化时保持展开状态一致。
   */
  id: string;
  nodeIds: string[];
}

export interface NodeGroups {
  connected: NodeGroup[];
  isolated: string[];
}

export function buildConnectionInfo(
  nodeIds: string[],
  edges: EdgeLike[],
): ConnectionInfoMap {
  const info: ConnectionInfoMap = {};
  nodeIds.forEach((id) => {
    info[id] = { outgoing: [], incoming: [] };
  });

  edges.forEach((e) => {
    const data = e.data as KnowledgeEdgeData | undefined;
    const labelStr = typeof e.label === "string" ? e.label : undefined;
    const edgeConnection: Omit<EdgeConnection, "nodeId"> = {
      edgeId: e.id,
      label: labelStr || data?.label,
      relation: data?.relation,
    };

    if (info[e.source]) {
      info[e.source].outgoing.push({ ...edgeConnection, nodeId: e.target });
    }
    if (info[e.target]) {
      info[e.target].incoming.push({ ...edgeConnection, nodeId: e.source });
    }
  });

  return info;
}

/**
 * 计算连通分量（把边视为无向边），并区分完全无连接的孤立节点。
 */
export function computeNodeGroups(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
  connectionInfo: ConnectionInfoMap,
): NodeGroups {
  const parent: Record<string, string> = {};

  const find = (x: string): string => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };

  // 让 union 的结果尽量稳定：始终把更大的 root 挂到更小的 root 上
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const [small, large] = ra < rb ? [ra, rb] : [rb, ra];
    parent[large] = small;
  };

  nodeIds.forEach((id) => {
    parent[id] = id;
  });

  edges.forEach((e) => {
    if (parent[e.source] && parent[e.target]) {
      union(e.source, e.target);
    }
  });

  const groupMap: Record<string, string[]> = {};
  nodeIds.forEach((id) => {
    const root = find(id);
    if (!groupMap[root]) groupMap[root] = [];
    groupMap[root].push(id);
  });

  const connected: NodeGroup[] = [];
  const isolated: string[] = [];

  Object.entries(groupMap).forEach(([root, ids]) => {
    if (ids.length === 1) {
      const nodeId = ids[0];
      const conn = connectionInfo[nodeId];
      const isIsolated = !conn || (conn.outgoing.length === 0 && conn.incoming.length === 0);
      if (isIsolated) {
        isolated.push(nodeId);
        return;
      }
    }
    connected.push({ id: root, nodeIds: ids });
  });

  // 群组排序：先按大小降序，再按 id 作为稳定兜底
  connected.sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.id.localeCompare(b.id));

  return { connected, isolated };
}

export interface NodeOutlineStats {
  usedColors: Array<[NodeColor, number]>;
  topTags: Array<[string, number]>;
  totalTags: number;
  uniqueTags: number;
}

export function computeNodeOutlineStats(nodes: Array<{ data: KnowledgeNodeData }>): NodeOutlineStats {
  const colorCounts: Record<NodeColor, number> = {
    default: 0,
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    blue: 0,
    purple: 0,
    pink: 0,
  };

  const tagCounts: Record<string, number> = {};
  let totalTags = 0;

  nodes.forEach((node) => {
    const data = node.data;
    const color = data.color || "default";
    colorCounts[color]++;

    if (data.tags) {
      data.tags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        totalTags++;
      });
    }
  });

  const usedColors = (Object.entries(colorCounts) as [NodeColor, number][])
    .filter(([, count]) => count > 0);

  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return {
    usedColors,
    topTags,
    totalTags,
    uniqueTags: Object.keys(tagCounts).length,
  };
}
