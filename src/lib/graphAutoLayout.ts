import type { Edge, Node } from "@xyflow/react";
import type { KnowledgeNodeData } from "@/types";
import { NODE_CENTER_OFFSET } from "@/constants/graphLayout";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;
type GraphEdge = Edge;

type LayoutStyle = "layered" | "radial";

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface AutoLayoutOptions {
  layoutStyle?: LayoutStyle; // layered=分层树状；radial=发散同心圆
  includeOtherComponents?: boolean; // 是否同时整理其它不连通分量（默认否）
  ringSpacing?: number; // 每一层（最短距离）之间的间距（像素）
  nodeSpacing?: number; // 同一层节点的目标间距（像素，近似）
  componentGap?: number; // 不同连通分量之间的间隔（像素）
  columnMaxHeight?: number; // 额外分量摆放时单列最大高度（像素）
  xScale?: number; // 横向拉伸（让布局更“扁平”）
  yScale?: number; // 纵向拉伸
  maxAttempts?: number; // 尝试不同排序的次数（用于减少/消除连线交叉）
}

export interface AutoLayoutResult {
  positions: Map<string, Point>; // ReactFlow node.position（左上角坐标）
  crossings: number; // 估算的连线交叉数量（基于节点中心直线段）
}

const DEFAULT_OPTIONS: Required<AutoLayoutOptions> = {
  layoutStyle: "radial",
  includeOtherComponents: false,
  ringSpacing: 140,
  nodeSpacing: 140,
  componentGap: 320,
  columnMaxHeight: 1200,
  xScale: 1,
  yScale: 1,
  maxAttempts: 12,
};

function getNodeHalfSizeWithPadding(padding: number) {
  return {
    halfWidth: NODE_CENTER_OFFSET.x + padding,
    halfHeight: NODE_CENTER_OFFSET.y + padding,
  };
}

function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }, halfWidth: number, halfHeight: number) {
  return Math.abs(a.x - b.x) < halfWidth * 2 && Math.abs(a.y - b.y) < halfHeight * 2;
}

function hasAnyNodeOverlap(args: {
  centers: Map<string, Point>;
  ids: string[];
  scale: number;
  padding: number;
}) {
  const { centers, ids, scale, padding } = args;
  const { halfWidth, halfHeight } = getNodeHalfSizeWithPadding(padding);
  const cellSize = Math.max(halfWidth * 2, halfHeight * 2);

  const scaled = new Map<string, Point>();
  const grid = new Map<string, string[]>();

  for (const id of ids) {
    const p = centers.get(id);
    if (!p) continue;
    const pos = { x: p.x * scale, y: p.y * scale };
    scaled.set(id, pos);

    const minCellX = Math.floor((pos.x - halfWidth) / cellSize);
    const maxCellX = Math.floor((pos.x + halfWidth) / cellSize);
    const minCellY = Math.floor((pos.y - halfHeight) / cellSize);
    const maxCellY = Math.floor((pos.y + halfHeight) / cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cy = minCellY; cy <= maxCellY; cy += 1) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (!bucket) continue;

        for (const otherId of bucket) {
          const other = scaled.get(otherId);
          if (!other) continue;
          if (boxesOverlap(pos, other, halfWidth, halfHeight)) return true;
        }
      }
    }

    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cy = minCellY; cy <= maxCellY; cy += 1) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(id);
        else grid.set(key, [id]);
      }
    }
  }

  return false;
}

function compressCentersIfPossible(args: {
  centers: Map<string, Point>;
  ids: string[];
  minScale: number;
  padding: number;
}) {
  const { centers, ids, minScale, padding } = args;
  const safeMinScale = Math.max(0.1, Math.min(1, minScale));

  if (!hasAnyNodeOverlap({ centers, ids, scale: safeMinScale, padding })) {
    const scaled = new Map<string, Point>();
    ids.forEach((id) => {
      const p = centers.get(id);
      if (!p) return;
      scaled.set(id, { x: p.x * safeMinScale, y: p.y * safeMinScale });
    });
    return { centers: scaled, scale: safeMinScale };
  }

  let low = safeMinScale;
  let high = 1;
  for (let iter = 0; iter < 10; iter += 1) {
    const mid = (low + high) / 2;
    const overlap = hasAnyNodeOverlap({ centers, ids, scale: mid, padding });
    if (overlap) low = mid;
    else high = mid;
  }

  const scaled = new Map<string, Point>();
  ids.forEach((id) => {
    const p = centers.get(id);
    if (!p) return;
    scaled.set(id, { x: p.x * high, y: p.y * high });
  });
  return { centers: scaled, scale: high };
}

function buildUndirectedAdjacency(nodeIds: Set<string>, edges: GraphEdge[]) {
  const adjacency = new Map<string, string[]>();
  nodeIds.forEach((id) => adjacency.set(id, []));

  edges.forEach((e) => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return;
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  });

  return adjacency;
}

function computeComponentIdSetFromRoot(rootId: string, adjacency: Map<string, string[]>) {
  const visited = new Set<string>();
  const queue = [rootId];
  let head = 0;
  visited.add(rootId);

  while (head < queue.length) {
    const currentId = queue[head++]!;
    const neighbors = adjacency.get(currentId) || [];
    neighbors.forEach((neighborId) => {
      if (visited.has(neighborId)) return;
      visited.add(neighborId);
      queue.push(neighborId);
    });
  }

  return visited;
}

function computeConnectedComponents(nodeIds: string[], adjacency: Map<string, string[]>) {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const startId of nodeIds) {
    if (visited.has(startId)) continue;
    visited.add(startId);

    const queue = [startId];
    let head = 0;
    const component: string[] = [];

    while (head < queue.length) {
      const currentId = queue[head++]!;
      component.push(currentId);
      const neighbors = adjacency.get(currentId) || [];
      neighbors.forEach((neighborId) => {
        if (visited.has(neighborId)) return;
        visited.add(neighborId);
        queue.push(neighborId);
      });
    }

    components.push(component);
  }

  return components;
}

function computeBoundsFromCenters(centers: Map<string, Point>, ids: string[], padding = 0): Bounds {
  const halfWidth = NODE_CENTER_OFFSET.x;
  const halfHeight = NODE_CENTER_OFFSET.y;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  ids.forEach((id) => {
    const p = centers.get(id);
    if (!p) return;
    minX = Math.min(minX, p.x - halfWidth);
    maxX = Math.max(maxX, p.x + halfWidth);
    minY = Math.min(minY, p.y - halfHeight);
    maxY = Math.max(maxY, p.y + halfHeight);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function orientation(a: Point, b: Point, c: Point) {
  const v = cross(a, b, c);
  const EPS = 1e-9;
  if (Math.abs(v) < EPS) return 0;
  return v > 0 ? 1 : -1;
}

// 仅统计“真正穿过”的交叉：排除端点相触与共线情况
function segmentsProperlyCross(p1: Point, q1: Point, p2: Point, q2: Point) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function countEdgeCrossings(args: {
  centers: Map<string, Point>;
  edges: GraphEdge[];
  nodeIdSet: Set<string>;
}) {
  const { centers, edges, nodeIdSet } = args;
  const componentEdges = edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
  let crossings = 0;

  for (let i = 0; i < componentEdges.length; i += 1) {
    const a = componentEdges[i]!;
    const a1 = centers.get(a.source);
    const a2 = centers.get(a.target);
    if (!a1 || !a2) continue;

    for (let j = i + 1; j < componentEdges.length; j += 1) {
      const b = componentEdges[j]!;

      // 共享端点的边不算交叉
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;

      const b1 = centers.get(b.source);
      const b2 = centers.get(b.target);
      if (!b1 || !b2) continue;

      if (segmentsProperlyCross(a1, a2, b1, b2)) crossings += 1;
    }
  }

  return crossings;
}

function edgesShareEndpoint(a: GraphEdge, b: GraphEdge) {
  return a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target;
}

function buildIncidentEdgeIndexMap(edges: GraphEdge[]) {
  const incident = new Map<string, number[]>();
  edges.forEach((e, index) => {
    const sourceList = incident.get(e.source);
    if (sourceList) sourceList.push(index);
    else incident.set(e.source, [index]);

    const targetList = incident.get(e.target);
    if (targetList) targetList.push(index);
    else incident.set(e.target, [index]);
  });
  return incident;
}

function getLevelY(index: number, count: number, spacingY: number) {
  return (index - (count - 1) / 2) * spacingY;
}

/**
 * 统计“至少包含一条 affectedEdges”的交叉数，用于交换时的增量评估。
 * 说明：只重算受影响的边对，比全量 O(E^2) 更快。
 */
function countCrossingsInvolvingMarkedEdgeIndices(args: {
  edges: GraphEdge[];
  centers: Map<string, Point>;
  affectedEdgeIndices: number[];
  isAffected: Uint8Array;
}) {
  const { edges, centers, affectedEdgeIndices, isAffected } = args;
  if (affectedEdgeIndices.length === 0) return 0;

  let crossings = 0;

  // affected vs unaffected
  affectedEdgeIndices.forEach((idx) => {
    const a = edges[idx];
    if (!a) return;
    const a1 = centers.get(a.source);
    const a2 = centers.get(a.target);
    if (!a1 || !a2) return;

    for (let j = 0; j < edges.length; j += 1) {
      if (isAffected[j] === 1) continue;
      const b = edges[j]!;
      if (edgesShareEndpoint(a, b)) continue;
      const b1 = centers.get(b.source);
      const b2 = centers.get(b.target);
      if (!b1 || !b2) continue;
      if (segmentsProperlyCross(a1, a2, b1, b2)) crossings += 1;
    }
  });

  // affected vs affected (i<j)
  for (let i = 0; i < affectedEdgeIndices.length; i += 1) {
    const aIdx = affectedEdgeIndices[i]!;
    const a = edges[aIdx];
    if (!a) continue;
    const a1 = centers.get(a.source);
    const a2 = centers.get(a.target);
    if (!a1 || !a2) continue;

    for (let j = i + 1; j < affectedEdgeIndices.length; j += 1) {
      const bIdx = affectedEdgeIndices[j]!;
      const b = edges[bIdx];
      if (!b) continue;
      if (edgesShareEndpoint(a, b)) continue;
      const b1 = centers.get(b.source);
      const b2 = centers.get(b.target);
      if (!b1 || !b2) continue;
      if (segmentsProperlyCross(a1, a2, b1, b2)) crossings += 1;
    }
  }

  return crossings;
}

function chooseComponentCenterId(componentIds: string[], adjacency: Map<string, string[]>, orderIndex: Map<string, number>) {
  let bestId = componentIds[0]!;
  let bestDegree = -1;
  let bestOrder = Number.POSITIVE_INFINITY;

  componentIds.forEach((id) => {
    const degree = adjacency.get(id)?.length ?? 0;
    const order = orderIndex.get(id) ?? Number.POSITIVE_INFINITY;
    if (degree > bestDegree) {
      bestId = id;
      bestDegree = degree;
      bestOrder = order;
      return;
    }
    if (degree === bestDegree && order < bestOrder) {
      bestId = id;
      bestOrder = order;
    }
  });

  return bestId;
}

function computeRadialCentersForComponent(args: {
  componentIds: string[];
  centerId: string;
  adjacency: Map<string, string[]>;
  orderIndex: Map<string, number>;
  edges: GraphEdge[];
  options: Required<AutoLayoutOptions>;
  seed: number;
}): { centers: Map<string, Point>; crossings: number } {
  const { componentIds, centerId, adjacency, orderIndex, edges, options, seed } = args;
  const componentSet = new Set(componentIds);
  const componentEdges = edges.filter((e) => componentSet.has(e.source) && componentSet.has(e.target));

  // BFS 计算最短距离，并记录一棵“生成树”的 parent（用于划分根节点的子树扇区）
  const distanceMap = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  const queue = [centerId];
  let head = 0;
  distanceMap.set(centerId, 0);
  parentMap.set(centerId, null);

  while (head < queue.length) {
    const currentId = queue[head++]!;
    const currentDistance = distanceMap.get(currentId);
    if (currentDistance === undefined) continue;

    const neighbors = adjacency.get(currentId) || [];
    neighbors.forEach((neighborId) => {
      if (!componentSet.has(neighborId)) return;
      if (distanceMap.has(neighborId)) return;
      distanceMap.set(neighborId, currentDistance + 1);
      parentMap.set(neighborId, currentId);
      queue.push(neighborId);
    });
  }

  const maxDistance = Math.max(0, ...Array.from(distanceMap.values()));

  // 根节点的第一层邻居作为“一级子树”入口：每棵子树占据一个方向（扇区），互不侵扰
  const rootChildren = componentIds.filter((id) => distanceMap.get(id) === 1);
  rootChildren.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

  // 特殊情况：只有根节点
  const centers = new Map<string, Point>();
  centers.set(centerId, { x: 0, y: 0 });
  if (rootChildren.length === 0) return { centers, crossings: 0 };

  const groupCache = new Map<string, string>();
  const getRootChildGroup = (nodeId: string): string | null => {
    if (nodeId === centerId) return null;
    const cached = groupCache.get(nodeId);
    if (cached) return cached;
    const parent = parentMap.get(nodeId);
    if (!parent) return null;
    if (parent === centerId) {
      groupCache.set(nodeId, nodeId);
      return nodeId;
    }
    const group = getRootChildGroup(parent);
    if (group) groupCache.set(nodeId, group);
    return group;
  };

  const groupSize = new Map<string, number>();
  rootChildren.forEach((id) => groupSize.set(id, 0));
  componentIds.forEach((id) => {
    if (id === centerId) return;
    const group = getRootChildGroup(id);
    if (!group) return;
    groupSize.set(group, (groupSize.get(group) ?? 0) + 1);
  });

  // 收集每棵子树在各个深度的节点，并按“父节点角度”排序，尽量让子节点靠近父节点方向
  const groupDepthNodes = new Map<string, Map<number, string[]>>();
  rootChildren.forEach((groupId) => groupDepthNodes.set(groupId, new Map()));

  componentIds.forEach((id) => {
    if (id === centerId) return;
    const depth = distanceMap.get(id);
    if (!depth || depth <= 0) return;
    const group = getRootChildGroup(id);
    if (!group) return;
    const depthMap = groupDepthNodes.get(group);
    if (!depthMap) return;
    const list = depthMap.get(depth);
    if (list) list.push(id);
    else depthMap.set(depth, [id]);
  });

  // 扇区几何：按子树规模分配角度，同时留出少量间隔避免“边界挤压”
  const totalGap = Math.min(2 * Math.PI * 0.04, 0.35);
  const gap = totalGap / rootChildren.length;
  const availableAngle = 2 * Math.PI - totalGap;
  const baseStartAngle = -Math.PI / 2 + seed * 0.37;

  const groupWedge = new Map<string, { start: number; span: number; innerStart: number; innerSpan: number }>();
  const groupWeight = new Map<string, number>();
  rootChildren.forEach((groupId) => {
    const depthMap = groupDepthNodes.get(groupId);
    let maxLayerCount = 1;
    depthMap?.forEach((ids) => {
      maxLayerCount = Math.max(maxLayerCount, ids.length);
    });
    const size = Math.max(1, groupSize.get(groupId) ?? 1);
    // 经验权重：更偏向“最大层宽”，同时对总规模做轻度加权，避免极端树被分到过窄扇区
    const weight = Math.max(1, maxLayerCount + Math.round(Math.sqrt(size) * 0.35));
    groupWeight.set(groupId, weight);
  });
  const totalWeight = Math.max(
    1,
    rootChildren.reduce((sum, id) => sum + (groupWeight.get(id) ?? 1), 0),
  );

  let cursorAngle = baseStartAngle;
  rootChildren.forEach((groupId) => {
    const weight = groupWeight.get(groupId) ?? Math.max(1, groupSize.get(groupId) ?? 1);
    const span = availableAngle * (weight / totalWeight);
    const margin = Math.min(0.06, span * 0.08);
    const innerSpan = Math.max(1e-4, span - 2 * margin);
    groupWedge.set(groupId, { start: cursorAngle, span, innerStart: cursorAngle + margin, innerSpan });
    cursorAngle += span + gap;
  });

  // 先按深度给每个节点分配角度（角度只决定“方向”，半径后算）
  const angleById = new Map<string, number>();
  angleById.set(centerId, 0);

  for (let depth = 1; depth <= maxDistance; depth += 1) {
    rootChildren.forEach((groupId) => {
      const wedge = groupWedge.get(groupId);
      if (!wedge) return;
      const depthMap = groupDepthNodes.get(groupId);
      const ids = depthMap?.get(depth);
      if (!ids || ids.length === 0) return;

      ids.sort((a, b) => {
        const pa = parentMap.get(a);
        const pb = parentMap.get(b);
        const aa = pa ? (angleById.get(pa) ?? 0) : 0;
        const ab = pb ? (angleById.get(pb) ?? 0) : 0;
        if (aa !== ab) return aa - ab;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });

      const count = ids.length;
      const alpha = depth <= 1 ? 0 : Math.max(0.25, 0.45 - (depth - 2) * 0.08); // 越深越“展开”，避免子树塌缩成直线

      for (let index = 0; index < count; index += 1) {
        const id = ids[index]!;
        const uniformAngle = wedge.innerStart + wedge.innerSpan * ((index + 0.5) / count);

        const parentId = parentMap.get(id);
        const desiredAngle = parentId ? (angleById.get(parentId) ?? uniformAngle) : uniformAngle;
        const angle = uniformAngle * (1 - alpha) + desiredAngle * alpha;

        angleById.set(id, angle);
      }
    });
  }

  // 再按“子树扇区”分别计算半径：避免某个子树很大时把所有子树都推得很远，导致空间利用率低
  const minRingSpacing = Math.max(options.ringSpacing, NODE_CENTER_OFFSET.y * 2 + 28);
  const minNodeSpacing = Math.max(options.nodeSpacing, NODE_CENTER_OFFSET.x * 2 + 24);
  const radiusByGroupDepth = new Map<string, Map<number, number>>();
  rootChildren.forEach((groupId) => {
    const wedge = groupWedge.get(groupId);
    if (!wedge) return;
    const depthMap = groupDepthNodes.get(groupId);
    if (!depthMap) return;
    const radiusMap = new Map<number, number>();
    let prevRadius = 0;
    for (let depth = 1; depth <= maxDistance; depth += 1) {
      const count = depthMap.get(depth)?.length ?? 0;
      if (count === 0) continue;
      const baseRadius = prevRadius + minRingSpacing;
      let requiredRadius = 0;
      if (count > 1) {
        // 近似按弧长估算同层最小半径：r * angleSpan >= spacing * (n-1)
        requiredRadius = (minNodeSpacing * (count - 1)) / wedge.innerSpan;
      }
      const radius = Math.max(baseRadius, requiredRadius);
      radiusMap.set(depth, radius);
      prevRadius = radius;
    }
    radiusByGroupDepth.set(groupId, radiusMap);
  });

  // 计算最终坐标
  componentIds.forEach((id) => {
    if (id === centerId) return;
    const depth = distanceMap.get(id);
    if (!depth || depth <= 0) return;
    const group = getRootChildGroup(id);
    const radius = group ? (radiusByGroupDepth.get(group)?.get(depth) ?? depth * minRingSpacing) : depth * minRingSpacing;
    const angle = angleById.get(id);
    if (angle === undefined) return;
    centers.set(id, {
      x: Math.cos(angle) * radius * options.xScale,
      y: Math.sin(angle) * radius * options.yScale,
    });
  });

  // 进一步压缩：在不重叠的前提下整体收紧，提升空间利用率（仅影响相对坐标，不改变方向）
  const compress = compressCentersIfPossible({
    centers,
    ids: [centerId, ...componentIds.filter((id) => id !== centerId)],
    minScale: 0.35,
    padding: 10,
  });
  const finalCenters = compress.centers;

  let crossings = 0;
  if (componentEdges.length > 1) {
    crossings = countEdgeCrossings({ centers: finalCenters, edges: componentEdges, nodeIdSet: componentSet });
  }

  return { centers: finalCenters, crossings };
}

function computeLayeredCentersForComponent(args: {
  componentIds: string[];
  centerId: string;
  adjacency: Map<string, string[]>;
  orderIndex: Map<string, number>;
  edges: GraphEdge[];
  options: Required<AutoLayoutOptions>;
  seed: number;
}): { centers: Map<string, Point>; crossings: number } {
  const { componentIds, centerId, adjacency, orderIndex, edges, options, seed } = args;
  const componentSet = new Set(componentIds);
  const componentEdges = edges.filter((e) => componentSet.has(e.source) && componentSet.has(e.target));

  // BFS 计算最短距离（用于分层）
  const distanceMap = new Map<string, number>();
  const queue = [centerId];
  let head = 0;
  distanceMap.set(centerId, 0);

  while (head < queue.length) {
    const currentId = queue[head++]!;
    const currentDistance = distanceMap.get(currentId);
    if (currentDistance === undefined) continue;

    const neighbors = adjacency.get(currentId) || [];
    neighbors.forEach((neighborId) => {
      if (!componentSet.has(neighborId)) return;
      if (distanceMap.has(neighborId)) return;
      distanceMap.set(neighborId, currentDistance + 1);
      queue.push(neighborId);
    });
  }

  // 分层聚合
  const levels = new Map<number, string[]>();
  componentIds.forEach((id) => {
    const d = distanceMap.get(id);
    if (d === undefined) return;
    const list = levels.get(d);
    if (list) list.push(id);
    else levels.set(d, [id]);
  });

  const maxDistance = Math.max(0, ...Array.from(levels.keys()));

  const orderedLevels = new Map<number, string[]>();
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const ids = (levels.get(distance) || []).slice();
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

    // 简单扰动初始顺序，便于多次尝试找到无交叉解
    if (ids.length > 1) {
      if (seed % 2 === 1) ids.reverse();
      const offset = seed % ids.length;
      if (offset !== 0) {
        ids.push(...ids.splice(0, offset));
      }
    }

    orderedLevels.set(distance, ids);
  }

  const computeBarycenter = (nodeId: string, neighborDistance: number, neighborIndex: Map<string, number>) => {
    const neighbors = adjacency.get(nodeId) || [];
    let sum = 0;
    let count = 0;
    neighbors.forEach((neighborId) => {
      if (distanceMap.get(neighborId) !== neighborDistance) return;
      const idx = neighborIndex.get(neighborId);
      if (idx === undefined) return;
      sum += idx;
      count += 1;
    });
    if (count === 0) return null;
    return sum / count;
  };

  // 迭代应用 barycenter（典型层级图交叉最小化启发式）
  for (let iter = 0; iter < 8; iter += 1) {
    // forward sweep
    for (let distance = 1; distance <= maxDistance; distance += 1) {
      const current = orderedLevels.get(distance);
      const prev = orderedLevels.get(distance - 1);
      if (!current || !prev || current.length <= 1) continue;

      const prevIndex = new Map<string, number>();
      prev.forEach((id, idx) => prevIndex.set(id, idx));

      current.sort((a, b) => {
        const ba = computeBarycenter(a, distance - 1, prevIndex);
        const bb = computeBarycenter(b, distance - 1, prevIndex);
        if (ba === null && bb === null) {
          return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
        }
        if (ba === null) return 1;
        if (bb === null) return -1;
        if (ba !== bb) return ba - bb;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });
    }

    // backward sweep
    for (let distance = maxDistance - 1; distance >= 0; distance -= 1) {
      const current = orderedLevels.get(distance);
      const next = orderedLevels.get(distance + 1);
      if (!current || !next || current.length <= 1) continue;

      const nextIndex = new Map<string, number>();
      next.forEach((id, idx) => nextIndex.set(id, idx));

      current.sort((a, b) => {
        const ba = computeBarycenter(a, distance + 1, nextIndex);
        const bb = computeBarycenter(b, distance + 1, nextIndex);
        if (ba === null && bb === null) {
          return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
        }
        if (ba === null) return 1;
        if (bb === null) return -1;
        if (ba !== bb) return ba - bb;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });
    }
  }

  const centers = new Map<string, Point>();
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const ids = orderedLevels.get(distance) || [];
    const count = ids.length;
    const x = options.ringSpacing * distance * options.xScale;
    const spacingY = options.nodeSpacing * options.yScale;

    ids.forEach((id, index) => {
      // 以 0 为中心对齐
      const y = getLevelY(index, count, spacingY);
      centers.set(id, { x, y });
    });
  }

  // 兜底：确保中心节点存在
  if (!centers.has(centerId)) centers.set(centerId, { x: 0, y: 0 });

  // 先计算交叉数，若不为 0，则做一次局部交换优化（相邻交换 + 贪心下降）
  let crossings = 0;
  if (componentEdges.length > 1) {
    crossings = countEdgeCrossings({ centers, edges: componentEdges, nodeIdSet: componentSet });
  }

  if (crossings > 0 && componentEdges.length > 1) {
    const incident = buildIncidentEdgeIndexMap(componentEdges);
    const isAffected = new Uint8Array(componentEdges.length);
    const affectedIndices: number[] = [];
    const maxPasses = Math.min(24, Math.max(6, Math.ceil(componentIds.length / 10)));
    const maxSwaps = Math.min(2000, componentIds.length * 40);
    let swaps = 0;

    for (let pass = 0; pass < maxPasses && crossings > 0; pass += 1) {
      let improvedInPass = false;

      for (let distance = 0; distance <= maxDistance && crossings > 0; distance += 1) {
        const ids = orderedLevels.get(distance);
        if (!ids || ids.length <= 1) continue;

        const count = ids.length;
        const x = options.ringSpacing * distance * options.xScale;
        const spacingY = options.nodeSpacing * options.yScale;

        for (let i = 0; i < ids.length - 1 && crossings > 0; i += 1) {
          if (swaps >= maxSwaps) break;
          const aId = ids[i]!;
          const bId = ids[i + 1]!;

          const aIncident = incident.get(aId) || [];
          const bIncident = incident.get(bId) || [];
          if (aIncident.length === 0 && bIncident.length === 0) continue;

          affectedIndices.length = 0;
          aIncident.forEach((idx) => {
            if (isAffected[idx] === 1) return;
            isAffected[idx] = 1;
            affectedIndices.push(idx);
          });
          bIncident.forEach((idx) => {
            if (isAffected[idx] === 1) return;
            isAffected[idx] = 1;
            affectedIndices.push(idx);
          });

          const before = countCrossingsInvolvingMarkedEdgeIndices({
            edges: componentEdges,
            centers,
            affectedEdgeIndices: affectedIndices,
            isAffected,
          });

          // 尝试交换
          ids[i] = bId;
          ids[i + 1] = aId;

          const yA = getLevelY(i, count, spacingY);
          const yB = getLevelY(i + 1, count, spacingY);
          centers.set(aId, { x, y: yB });
          centers.set(bId, { x, y: yA });

          const after = countCrossingsInvolvingMarkedEdgeIndices({
            edges: componentEdges,
            centers,
            affectedEdgeIndices: affectedIndices,
            isAffected,
          });

          if (after < before) {
            crossings += after - before;
            improvedInPass = true;
            swaps += 1;
            affectedIndices.forEach((idx) => {
              isAffected[idx] = 0;
            });
            continue;
          }

          // 回滚
          ids[i] = aId;
          ids[i + 1] = bId;
          centers.set(aId, { x, y: yA });
          centers.set(bId, { x, y: yB });
          swaps += 1;

          affectedIndices.forEach((idx) => {
            isAffected[idx] = 0;
          });
        }
      }

      if (!improvedInPass) break;
      if (swaps >= maxSwaps) break;
    }
  }

  return { centers, crossings };
}

function computeBestCentersForComponent(args: {
  componentIds: string[];
  centerId: string;
  adjacency: Map<string, string[]>;
  orderIndex: Map<string, number>;
  edges: GraphEdge[];
  options: Required<AutoLayoutOptions>;
}) {
  const { componentIds, centerId, adjacency, orderIndex, edges, options } = args;
  let bestCenters: Map<string, Point> | null = null;
  let bestCrossings = Number.POSITIVE_INFINITY;

  const attempts = Math.max(1, options.maxAttempts);
  for (let seed = 0; seed < attempts; seed += 1) {
    const computeFn = options.layoutStyle === "layered" ? computeLayeredCentersForComponent : computeRadialCentersForComponent;
    const { centers, crossings } = computeFn({ componentIds, centerId, adjacency, orderIndex, edges, options, seed });
    if (crossings === 0) {
      return { centers, crossings: 0 };
    }
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      bestCenters = centers;
    }
  }

  return { centers: bestCenters || new Map<string, Point>(), crossings: Number.isFinite(bestCrossings) ? bestCrossings : 0 };
}

/**
 * 自动布局：以 rootId 为中心，对“当前连通子图”进行整理（默认发散式 radial），并尽量减少连线交叉。
 * 特点：
 * - 根节点保持原位（以其中心点为锚点），其他节点重新排布
 * - 默认只整理与 root 相连的子图，避免“一键整理把所有不相连的图都挪走”
 * - 可选 includeOtherComponents=true，同时整理其它不连通分量（会移动更多节点）
 * - 只调整 position，不改变节点内容/边结构
 */
export function computeAutoLayoutPositions(args: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  options?: AutoLayoutOptions;
}): AutoLayoutResult {
  const { nodes, edges, rootId, options } = args;
  const mergedOptions: Required<AutoLayoutOptions> = { ...DEFAULT_OPTIONS, ...(options || {}) };

  const rootNode = nodes.find((n) => n.id === rootId);
  if (!rootNode) return { positions: new Map(), crossings: 0 };

  const nodeIdsInOrder = nodes.map((n) => n.id);
  const nodeIdSet = new Set(nodeIdsInOrder);

  const orderIndex = new Map<string, number>();
  nodeIdsInOrder.forEach((id, index) => orderIndex.set(id, index));

  const adjacency = buildUndirectedAdjacency(nodeIdSet, edges);
  const rootComponentIdSet = computeComponentIdSetFromRoot(rootId, adjacency);
  const rootComponentIds = nodeIdsInOrder.filter((id) => rootComponentIdSet.has(id));
  if (rootComponentIds.length === 0) return { positions: new Map(), crossings: 0 };

  // 根节点中心作为锚点（保持根节点原位）
  const rootCenter: Point = {
    x: rootNode.position.x + NODE_CENTER_OFFSET.x,
    y: rootNode.position.y + NODE_CENTER_OFFSET.y,
  };

  // 计算“根所在连通分量”的相对中心坐标，并平移到 rootCenter
  const placedCenters = new Map<string, Point>();
  const rootLayout = computeBestCentersForComponent({
    componentIds: rootComponentIds,
    centerId: rootId,
    adjacency,
    orderIndex,
    edges,
    options: mergedOptions,
  });
  const rootCentersRel = rootLayout.centers;
  rootComponentIds.forEach((id) => {
    const rel = rootCentersRel.get(id);
    if (!rel) return;
    placedCenters.set(id, { x: rootCenter.x + rel.x, y: rootCenter.y + rel.y });
  });

  // 可选：整理其它不连通分量（默认关闭，避免“一键整理把所有图都挪走”）
  let crossings = rootLayout.crossings;
  if (mergedOptions.includeOtherComponents) {
    const components = computeConnectedComponents(nodeIdsInOrder, adjacency);
    const otherComponents = components.filter((ids) => !ids.includes(rootId));

    const componentCenters: Array<{ ids: string[]; centerId: string; centers: Map<string, Point>; crossings: number }> = [];
    otherComponents.forEach((componentIds) => {
      const centerId = chooseComponentCenterId(componentIds, adjacency, orderIndex);
      const layout = computeBestCentersForComponent({
        componentIds,
        centerId,
        adjacency,
        orderIndex,
        edges,
        options: mergedOptions,
      });
      componentCenters.push({ ids: componentIds, centerId, centers: layout.centers, crossings: layout.crossings });
    });

    const rootBounds = computeBoundsFromCenters(placedCenters, rootComponentIds, 80);
    const columnMaxHeight = Math.max(mergedOptions.columnMaxHeight, rootBounds.height);

    let cursorX = rootBounds.maxX + mergedOptions.componentGap;
    let cursorY = rootBounds.minY;
    let columnWidth = 0;

    for (let i = 0; i < componentCenters.length; i += 1) {
      const { ids, centers } = componentCenters[i]!;
      const relBounds = computeBoundsFromCenters(centers, ids, 80);

      if (cursorY + relBounds.height > rootBounds.minY + columnMaxHeight && cursorY !== rootBounds.minY) {
        cursorX += columnWidth + mergedOptions.componentGap;
        cursorY = rootBounds.minY;
        columnWidth = 0;
      }

      const offsetX = cursorX - relBounds.minX;
      const offsetY = cursorY - relBounds.minY;

      ids.forEach((id) => {
        const rel = centers.get(id);
        if (!rel) return;
        placedCenters.set(id, { x: rel.x + offsetX, y: rel.y + offsetY });
      });

      cursorY += relBounds.height + mergedOptions.componentGap;
      columnWidth = Math.max(columnWidth, relBounds.width);
      crossings += componentCenters[i]!.crossings;
    }
  }

  // 转换为 ReactFlow 的左上角 position
  const positions = new Map<string, Point>();
  placedCenters.forEach((center, id) => {
    positions.set(id, {
      x: center.x - NODE_CENTER_OFFSET.x,
      y: center.y - NODE_CENTER_OFFSET.y,
    });
  });
  return { positions, crossings };
}
