import assert from "node:assert/strict";
import test from "node:test";
import { resolveManifestPath } from "../mcp/manifestPath.ts";

test("resolveManifestPath prefers Windows roaming AppData when running in WSL", () => {
  const manifestPath = resolveManifestPath({
    platform: "linux",
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
      APPDATA: "C:\\Users\\Jason\\AppData\\Roaming",
    },
    homedir: "/home/jason",
    release: "5.15.167.4-microsoft-standard-WSL2",
  });

  assert.equal(
    manifestPath,
    "/mnt/c/Users/Jason/AppData/Roaming/GraphAndTable/bridge_manifest.json",
  );
});
