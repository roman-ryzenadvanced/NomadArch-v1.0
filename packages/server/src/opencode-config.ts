import { cpSync, existsSync, mkdirSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { createLogger } from "./logger"
import { getOpencodeWorkspacesRoot, getUserDataRoot } from "./user-data"

const log = createLogger({ component: "opencode-config" })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const devTemplateDir = path.resolve(__dirname, "../../opencode-config")
const prodTemplateDir = path.resolve(__dirname, "opencode-config")

const isDevBuild = Boolean(process.env.CODENOMAD_DEV ?? process.env.CLI_UI_DEV_SERVER) || existsSync(devTemplateDir)
const templateDir = isDevBuild ? devTemplateDir : prodTemplateDir
const userConfigDir = path.join(getUserDataRoot(), "opencode-config")
const workspaceConfigRoot = getOpencodeWorkspacesRoot()

export function getOpencodeConfigDir(): string {
  if (!existsSync(templateDir)) {
    throw new Error(`CodeNomad Opencode config template missing at ${templateDir}`)
  }

  if (isDevBuild) {
    log.debug({ templateDir }, "Using Opencode config template directly (dev mode)")
    return templateDir
  }

  refreshUserConfig()
  return userConfigDir
}

export function ensureWorkspaceOpencodeConfig(workspaceId: string): string {
  if (!workspaceId) {
    return getOpencodeConfigDir()
  }
  if (!existsSync(templateDir)) {
    throw new Error(`CodeNomad Opencode config template missing at ${templateDir}`)
  }

  const targetDir = path.join(workspaceConfigRoot, workspaceId)
  if (existsSync(targetDir)) {
    return targetDir
  }

  mkdirSync(path.dirname(targetDir), { recursive: true })
  cpSync(templateDir, targetDir, { recursive: true })
  return targetDir
}

export function getWorkspaceOpencodeConfigDir(workspaceId: string): string {
  return path.join(workspaceConfigRoot, workspaceId)
}

function refreshUserConfig() {
  log.debug({ templateDir, userConfigDir }, "Syncing Opencode config template")
  rmSync(userConfigDir, { recursive: true, force: true })
  mkdirSync(path.dirname(userConfigDir), { recursive: true })
  cpSync(templateDir, userConfigDir, { recursive: true })
}
