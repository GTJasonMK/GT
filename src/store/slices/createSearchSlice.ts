import type { StoreApi } from "zustand";
import type { GraphStore } from "@/store/graphStore";
import { recomputeSearchResults } from "@/store/slices/graphHelpers";

interface CreateSearchSliceArgs {
  set: StoreApi<GraphStore>["setState"];
  get: StoreApi<GraphStore>["getState"];
}

export function createSearchSlice({ set, get }: CreateSearchSliceArgs): Pick<GraphStore, "setSearchQuery"> {
  return {
    setSearchQuery: (query) => {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        set({ searchQuery: "", searchResults: [] });
        return;
      }
      set({
        searchQuery: query,
        searchResults: recomputeSearchResults(get().nodes, normalizedQuery),
      });
    },
  };
}
