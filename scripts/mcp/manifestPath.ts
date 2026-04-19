import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface ManifestPathResolutionOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  homedir?: string;
  release?: string;
}

const WINDOWS_SYSTEM_USER_DIRS = new Set(["All Users", "Default", "Default User", "Public", "desktop.ini"]);

function isWslEnvironment(options: Required<ManifestPathResolutionOptions>): boolean {
  if (options.platform !== "linux") {
    return false;
  }
  const release = options.release.toLowerCase();
  return Boolean(options.env.WSL_DISTRO_NAME || options.env.WSL_INTEROP || release.includes("microsoft"));
}

function toWslPath(windowsPath: string): string | null {
  const normalized = windowsPath.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) {
    return null;
  }
  const driveLetter = match[1]!.toLowerCase();
  const pathSegments = match[2]!.split("/").filter(Boolean);
  return path.posix.join("/mnt", driveLetter, ...pathSegments);
}

function resolveWindowsRoamingAppDataDir(env: Record<string, string | undefined>): string | null {
  const candidates = [
    env.APPDATA,
    env.USERPROFILE ? path.win32.join(env.USERPROFILE, "AppData", "Roaming") : undefined,
    env.HOMEDRIVE && env.HOMEPATH ? path.win32.join(`${env.HOMEDRIVE}${env.HOMEPATH}`, "AppData", "Roaming") : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const wslPath = toWslPath(candidate);
    if (wslPath) {
      return wslPath;
    }
  }

  return null;
}

function resolveMountedWindowsRoamingAppDataDir(env: Record<string, string | undefined>): string | null {
  const usersRootDir = "/mnt/c/Users";
  if (!existsSync(usersRootDir)) {
    return null;
  }

  const usernames = readdirSync(usersRootDir)
    .filter((entry) => !WINDOWS_SYSTEM_USER_DIRS.has(entry));
  if (usernames.length === 0) {
    return null;
  }

  const preferredUsernames = [env.USERNAME, env.USER, env.LOGNAME].filter(Boolean) as string[];
  const matchedUsername = preferredUsernames.find((username) => usernames.includes(username));
  const resolvedUsername = matchedUsername ?? (usernames.length === 1 ? usernames[0]! : null);
  if (!resolvedUsername) {
    return null;
  }

  return path.posix.join(usersRootDir, resolvedUsername, "AppData", "Roaming");
}

function normalizeOptions(options: ManifestPathResolutionOptions): Required<ManifestPathResolutionOptions> {
  return {
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
    homedir: options.homedir ?? os.homedir(),
    release: options.release ?? os.release(),
  };
}

export function resolveAppDataDir(options: ManifestPathResolutionOptions = {}): string {
  const resolved = normalizeOptions(options);
  const explicitAppData = resolved.env.GT_BRIDGE_APPDATA?.trim();
  if (explicitAppData) {
    return explicitAppData;
  }

  if (resolved.platform === "win32") {
    return resolved.env.APPDATA ?? path.join(resolved.homedir, "AppData", "Roaming");
  }

  if (resolved.platform === "darwin") {
    return path.join(resolved.homedir, "Library", "Application Support");
  }

  if (isWslEnvironment(resolved)) {
    const windowsAppDataDir = resolveWindowsRoamingAppDataDir(resolved.env);
    if (windowsAppDataDir) {
      return windowsAppDataDir;
    }

    const mountedWindowsAppDataDir = resolveMountedWindowsRoamingAppDataDir(resolved.env);
    if (mountedWindowsAppDataDir) {
      return mountedWindowsAppDataDir;
    }
  }

  return resolved.env.XDG_DATA_HOME ?? path.join(resolved.homedir, ".local", "share");
}

export function resolveManifestPath(options: ManifestPathResolutionOptions = {}): string {
  const resolved = normalizeOptions(options);
  const explicitManifestPath = resolved.env.GT_BRIDGE_MANIFEST?.trim();
  if (explicitManifestPath) {
    return explicitManifestPath;
  }
  return path.join(resolveAppDataDir(resolved), "GraphAndTable", "bridge_manifest.json");
}
