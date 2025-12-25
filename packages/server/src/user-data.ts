import os from "os"
import path from "path"

const DEFAULT_ROOT = path.join(os.homedir(), ".config", "codenomad")

export function getUserDataRoot(): string {
  const override = process.env.CODENOMAD_USER_DIR
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }
  return DEFAULT_ROOT
}

export function getUserConfigPath(): string {
  return path.join(getUserDataRoot(), "config.json")
}

export function getUserInstancesDir(): string {
  return path.join(getUserDataRoot(), "instances")
}

export function getUserIntegrationsDir(): string {
  return path.join(getUserDataRoot(), "integrations")
}

export function getOpencodeWorkspacesRoot(): string {
  return path.join(getUserDataRoot(), "opencode-workspaces")
}
