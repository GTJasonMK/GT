import { createGraphWorkspaceRuntime } from "./createGraphWorkspaceRuntime.ts";
import { createGraphCapabilityClient } from "./graphCapabilityClient.ts";
import { agentExecutionStoreTracker } from "@/store/agentStore";
import { useGraphStore } from "@/store/graphStore";
import { exportGraphAsJsonFile } from "@/services/graphFileTransfer";
import { getGraphStorageInfo } from "@/services/graphStorage";

export const inProcessGraphWorkspaceRuntime = createGraphWorkspaceRuntime({
  tracker: agentExecutionStoreTracker,
  getWorkspaceReadModel: () => {
    const state = useGraphStore.getState();
    const selectedNodeCount = state.nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0) || (state.selectedNodeId ? 1 : 0);
    return {
      allData: state.exportData(),
      selectedData: state.exportSelectedNodesData(),
      selectedNodeCount,
      saveStatus: state.saveStatus,
    };
  },
  saveWorkspace: () => useGraphStore.getState().saveData(),
  replaceWorkspace: (data) => {
    useGraphStore.getState().importData(data);
  },
  exportWorkspaceJson: (data, filename) => exportGraphAsJsonFile(data, filename),
  describePersistenceTarget: () => getGraphStorageInfo(),
});

export const graphWorkspaceRuntime = createGraphCapabilityClient(inProcessGraphWorkspaceRuntime);
