import { cpSync, existsSync, mkdirSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { createLogger } from "./logger"

const log = createLogger({ component: "opencode-config" })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const devTemplateDir = path.resolve(__dirname, "../../opencode-config")
const prodTemplateDir = path.resolve(__dirname, "opencode-config")

const isDevBuild = Boolean(process.env.CODENOMAD_DEV ?? process.env.CLI_UI_DEV_SERVER) || existsSync(devTemplateDir)
const templateDir = isDevBuild ? devTemplateDir : prodTemplateDir
const userConfigDir = path.join(os.homedir(), ".config", "codenomad", "opencode-config")

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

function refreshUserConfig() {
  log.debug({ templateDir, userConfigDir }, "Syncing Opencode config template")
  rmSync(userConfigDir, { recursive: true, force: true })
  mkdirSync(path.dirname(userConfigDir), { recursive: true })
  cpSync(templateDir, userConfigDir, { recursive: true })
}
