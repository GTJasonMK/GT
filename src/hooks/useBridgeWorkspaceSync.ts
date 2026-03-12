import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { graphWorkspaceRuntime } from "@/agent/graphWorkspaceRuntime";
import type { GraphWorkspaceBridgeStatePayload } from "@/agent/types.ts";
import { isTauri } from "@/platform/runtime";
import { useAgentStore } from "@/store/agentStore";
import { useGraphStore } from "@/store/graphStore";

export function useBridgeWorkspaceSync() {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlistenBridgeEvent: UnlistenFn | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeGraphStore: (() => void) | null = null;
    let unsubscribeAgentStore: (() => void) | null = null;

    const scheduleSync = (reason: string) => {
      if (disposed) return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        void graphWorkspaceRuntime.bridge.syncState(
          graphWorkspaceRuntime.bridge.buildStatePayload(reason),
        );
      }, 80);
    };

    const start = async () => {
      const status = await graphWorkspaceRuntime.bridge.getStatus();
      if (!status.enabled || disposed) return;

      await graphWorkspaceRuntime.bridge.syncState(
        graphWorkspaceRuntime.bridge.buildStatePayload("app_bootstrap"),
      );

      unsubscribeGraphStore = useGraphStore.subscribe(
        (state) => [state.nodes, state.edges, state.selectedNodeId, state.saveStatus] as const,
        () => scheduleSync("graph_store_changed"),
        {
          equalityFn: (a, b) =>
            a[0] === b[0]
            && a[1] === b[1]
            && a[2] === b[2]
            && a[3] === b[3],
        },
      );

      unsubscribeAgentStore = useAgentStore.subscribe(() => {
        scheduleSync("agent_store_changed");
      });

      const { listen } = await import("@tauri-apps/api/event");
      unlistenBridgeEvent = await listen<GraphWorkspaceBridgeStatePayload>(
        "agent-bridge://state-changed",
        (event) => {
          graphWorkspaceRuntime.bridge.applyStatePayload(event.payload);
        },
      );
    };

    void start();

    return () => {
      disposed = true;
      if (syncTimer) clearTimeout(syncTimer);
      if (unlistenBridgeEvent) void unlistenBridgeEvent();
      if (unsubscribeGraphStore) unsubscribeGraphStore();
      if (unsubscribeAgentStore) unsubscribeAgentStore();
    };
  }, []);
}
