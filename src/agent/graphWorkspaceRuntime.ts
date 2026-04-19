import { createGraphWorkspaceRuntime } from "./createGraphWorkspaceRuntime.ts";
import { createGraphCapabilityClient } from "./graphCapabilityClient.ts";
import { agentExecutionStoreTracker } from "@/store/agentStore";
import { useGraphStore } from "@/store/graphStore";
import { resolveSelectedNodeIds } from "@/store/slices/graphHelpers";
import { exportGraphAsJsonFile } from "@/services/graphFileTransfer";
import { getGraphStorageInfo } from "@/services/graphStorage";

export const inProcessGraphWorkspaceRuntime = createGraphWorkspaceRuntime({
  tracker: agentExecutionStoreTracker,
  getWorkspaceReadModel: () => {
    const state = useGraphStore.getState();
    const selectedNodeIds = resolveSelectedNodeIds(state.nodes, state.selectedNodeId);
    return {
      allData: state.exportData(),
      selectedData: state.exportSelectedNodesData(),
      selectedNodeCount: selectedNodeIds.length,
      selectedNodeId: state.selectedNodeId,
      selectedNodeIds,
      saveStatus: state.saveStatus,
    };
  },
  saveWorkspace: () => useGraphStore.getState().saveData(),
  replaceWorkspace: (data) => {
    useGraphStore.getState().importData(data);
  },
  exportWorkspaceJson: (data, options) => exportGraphAsJsonFile(data, options),
  describePersistenceTarget: () => getGraphStorageInfo(),
});

export const graphWorkspaceRuntime = createGraphCapabilityClient(inProcessGraphWorkspaceRuntime);
