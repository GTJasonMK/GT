import type { StoreApi } from "zustand";
import type { GraphStore } from "@/store/graphStore";
import { normalizeEdgeData } from "@/lib/graphDataUtils";

interface CreateEdgeSliceArgs {
  set: StoreApi<GraphStore>["setState"];
  get: StoreApi<GraphStore>["getState"];
}

export function createEdgeSlice({ set, get }: CreateEdgeSliceArgs): Pick<GraphStore, "updateEdgeLabel"> {
  return {
    updateEdgeLabel: (edgeId, label) => {
      const normalizedLabel = label.trim() || undefined;
      set({
        edges: get().edges.map((edge) => {
          if (edge.id !== edgeId) return edge;

          const edgeData = normalizeEdgeData(edge.data);
          if (!edgeData) {
            return { ...edge, label: normalizedLabel };
          }

          return {
            ...edge,
            label: normalizedLabel,
            data: normalizedLabel
              ? { ...edgeData, label: normalizedLabel }
              : { relation: edgeData.relation },
          };
        }),
      });
    },
  };
}
