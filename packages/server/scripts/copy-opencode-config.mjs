#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cliRoot = path.resolve(__dirname, "..")
const sourceDir = path.resolve(cliRoot, "../opencode-config")
const targetDir = path.resolve(cliRoot, "dist/opencode-config")

if (!existsSync(sourceDir)) {
  console.error(`[copy-opencode-config] Missing source directory at ${sourceDir}`)
  process.exit(1)
}

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(path.dirname(targetDir), { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true })

console.log(`[copy-opencode-config] Copied ${sourceDir} -> ${targetDir}`)
