# GraphAndTable 导出/导入 JSON 格式说明

更新时间：2026-02-05｜编写：Codex

本项目“导出为 JSON 文件”的内容来自 `useGraphStore.exportData()`，并由 `JSON.stringify()` 直接序列化为一个对象（无额外包裹、无版本号）。导入时只做最基础校验：必须包含 `nodes` 与 `edges` 两个数组。

## 顶层结构（GraphData）

- `nodes`: 节点数组（知识点）
- `edges`: 连线数组（关系）

**最小可导入形态**：必须有 `nodes: []` 与 `edges: []`；但为了避免 UI 异常，建议每个节点都提供完整的 `data` 字段（见下文）。

## nodes[]（节点）

每个节点对象结构：

- `id`（string，必填）：节点唯一 ID。建议模式：`node_xxx`/`dx_xxx` 等；全图不可重复。
- `type`（string，建议填）：导出固定写为 `"knowledgeNode"`；导入时会强制使用该类型。
- `position`（object，必填）：节点左上角坐标（像素）。
  - `x`（number）：可为负数。
  - `y`（number）：可为负数。
  - 说明：这是 ReactFlow 的 `node.position`，**不是中心点坐标**。
- `data`（object，必填）：知识节点数据（`KnowledgeNodeData`）。

### data（KnowledgeNodeData）

- `label`（string，必填）：节点标题（画布上显示）。
- `content`（string，必填）：TipTap 富文本 HTML（编辑面板渲染）。建议用简单段落：`"<p>内容</p>"`；无内容可用空字符串。
- `tags`（string[]，必填）：标签数组；没有标签请用 `[]`（不要省略，否则编辑面板会报错）。
- `color`（string，可选）：节点颜色分类，取值：
  - `"default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink"`
- `edgeColor`（string，可选）：**该节点“发出的连线”**的重要度等级（连线颜色由源节点决定），取值：
  - `"default"` 或 `"p0".."p9"`（p0 最高，p9 最低）
  - 参考含义：`p0=核心`、`p1=极重要`、`p2=很重要`、`p3=重要`、`p4=较重要`、`p5=一般`、`p6=次要`、`p7=延伸`、`p8=参考`、`p9=可忽略`
  - 兼容旧值：`"core"→"p0"`、`"important"→"p3"`、`"normal"→"p5"`、`"minor"→"p6"`（导入时会自动映射）
- `locked`（boolean，可选）：是否锁定拖动（锁定时拖动会带动子节点）。
- `lockMode`（string，可选）：锁定范围：
  - `"direct"`：只带动**直接**子节点
  - `"transitive"`：带动**所有可达**子节点
  - 说明：子节点判断基于连线方向 `source -> target`。
- `createdAt`（number，必填）：创建时间戳（毫秒）。
- `updatedAt`（number，必填）：更新时间戳（毫秒）。
- 其他字段（可选）：`data` 允许额外自定义字段；会随导出/导入原样保留，但 UI 可能忽略。

## edges[]（连线）

每条连线对象结构：

- `id`（string，必填）：连线唯一 ID，全图不可重复。
- `source`（string，必填）：起点节点 ID（必须存在于 nodes）。
- `target`（string，必填）：终点节点 ID（必须存在于 nodes）。
- `label`（string，可选）：连线文本标签（用于显示/备注）。
- `data`（object，可选）：类型里预留 `KnowledgeEdgeData`（如 `relation`），**当前导入会忽略该字段**，再次导出也不会保留。

**方向语义很重要**：本项目的“锁定拖动/一键传递重要度”等功能只沿 `source -> target` 方向计算。

## 给 LLM 生成的硬性约束（建议照抄）

- 产出必须是**严格 JSON**（双引号、无注释）；需要保存为 `.json` 文件后导入。
- 顶层必须包含 `nodes` 与 `edges` 两个数组。
- 每个 `nodes[i].data` 必须包含：`label`、`content`、`tags`、`createdAt`、`updatedAt`（`tags` 至少是 `[]`）。
- `nodes[i].id`、`edges[i].id` 必须全局唯一；`edges[*].source/target` 必须引用已存在的节点 `id`。
- 如果不擅长排版坐标：用简单网格（例如 x 每列 +260，y 每行 +140），导入后再用“整理当前图”自动布局。

## 示例（推荐给 LLM 生成）

```json
{
  "nodes": [
    {
      "id": "node_root",
      "type": "knowledgeNode",
      "position": { "x": 0, "y": 0 },
      "data": {
        "label": "机器学习",
        "content": "<p>机器学习是从数据中学习规律的方法集合。</p>",
        "tags": ["AI", "概念"],
        "color": "blue",
        "edgeColor": "p1",
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000
      }
    },
    {
      "id": "node_supervised",
      "type": "knowledgeNode",
      "position": { "x": 260, "y": -80 },
      "data": {
        "label": "监督学习",
        "content": "<p>使用带标签数据训练模型。</p>",
        "tags": [],
        "edgeColor": "p3",
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000
      }
    }
  ],
  "edges": [
    { "id": "edge_1", "source": "node_root", "target": "node_supervised", "label": "包含" }
  ]
}
```

## 常见错误与建议

- `tags` 缺失或不是数组：编辑面板会在 `tags.map(...)` 处出错；请始终给 `[]`。
- `createdAt/updatedAt` 缺失：底部“创建于”会显示无效日期；建议用毫秒时间戳（如 `Date.now()`）。
- `source/target` 指向不存在的节点：连线可能不显示或导致后续功能异常。
- 节点都挤在一起看不清：给一个简单网格坐标，或导入后选中根节点点击“整理当前图”进行自动布局。
