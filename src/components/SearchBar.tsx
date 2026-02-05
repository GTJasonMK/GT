import { useCallback, useRef, type FC } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useGraphStore } from "@/store/graphStore";
import { SEARCH_INPUT_ID } from "@/constants/dom";
import { useFocusNode } from "@/hooks/useFocusNode";
import type { Node } from "@xyflow/react";
import type { KnowledgeNodeData } from "@/types";

type GraphNode = Node<KnowledgeNodeData, "knowledgeNode">;

function areNodesEqualByIdAndData(prev: GraphNode[], next: GraphNode[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.id !== next[i]?.id) return false;
    if (prev[i]?.data !== next[i]?.data) return false;
  }
  return true;
}

/**
 * 搜索栏组件
 * 支持按节点标题、标签和内容搜索
 */
const SearchBar: FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusNode = useFocusNode();

  const searchQuery = useGraphStore((s) => s.searchQuery);
  const searchResults = useGraphStore((s) => s.searchResults);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const nodes = useStoreWithEqualityFn(useGraphStore, (s) => s.nodes, areNodesEqualByIdAndData);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery],
  );

  // 点击搜索结果定位到节点
  const handleResultClick = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNodeId(nodeId);
        focusNode(node);
      }
    },
    [setSelectedNodeId, focusNode],
  );

  // Enter聚焦到第一个搜索结果
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && searchResults.length > 0) {
        handleResultClick(searchResults[0]);
      }
      if (e.key === "Escape") {
        setSearchQuery("");
        inputRef.current?.blur();
      }
    },
    [searchResults, handleResultClick, setSearchQuery],
  );

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-dark border border-border rounded-lg focus-within:border-primary-light focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          id={SEARCH_INPUT_ID}
          type="text"
          value={searchQuery}
          onChange={handleSearch}
          onKeyDown={handleKeyDown}
          placeholder="搜索节点... (Ctrl+F)"
          className="bg-transparent text-sm outline-none w-36 text-text placeholder:text-text-muted/50"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-text-muted hover:text-text cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* 搜索结果下拉列表 */}
      {searchQuery && searchResults.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto bg-white rounded-lg shadow-lg border border-border z-50">
          <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border">
            找到 {searchResults.length} 个结果
          </div>
          {searchResults.map((nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) return null;
            const data = node.data;
            return (
              <button
                key={nodeId}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface cursor-pointer transition-colors duration-100 flex items-center gap-2"
                onClick={() => handleResultClick(nodeId)}
              >
                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                <span className="truncate text-text">{data.label || "未命名"}</span>
                {data.tags && data.tags.length > 0 && (
                  <span className="text-[10px] text-text-muted ml-auto shrink-0">
                    {data.tags[0]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {searchQuery && searchResults.length === 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-border z-50">
          <div className="px-3 py-3 text-sm text-text-muted text-center">
            未找到匹配的节点
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
