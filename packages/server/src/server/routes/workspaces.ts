import { FastifyInstance, FastifyReply } from "fastify"
import { spawnSync } from "child_process"
import { z } from "zod"
import { existsSync, mkdirSync } from "fs"
import { cp, readFile, writeFile, stat as readFileStat } from "fs/promises"
import path from "path"
import { WorkspaceManager } from "../../workspaces/manager"
import { InstanceStore } from "../../storage/instance-store"
import { ConfigStore } from "../../config/store"
import { getWorkspaceOpencodeConfigDir } from "../../opencode-config"

interface RouteDeps {
  workspaceManager: WorkspaceManager
  instanceStore: InstanceStore
  configStore: ConfigStore
}

const WorkspaceCreateSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
})

const WorkspaceFilesQuerySchema = z.object({
  path: z.string().optional(),
})

const WorkspaceFileContentQuerySchema = z.object({
  path: z.string(),
})

const WorkspaceFileSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Query is required"),
  limit: z.coerce.number().int().positive().max(200).optional(),
  type: z.enum(["all", "file", "directory"]).optional(),
  refresh: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
})

export function registerWorkspaceRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/api/workspaces", async () => {
    return deps.workspaceManager.list()
  })

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const body = WorkspaceCreateSchema.parse(request.body ?? {})
      const workspace = await deps.workspaceManager.create(body.path, body.name)
      reply.code(201)
      return workspace
    } catch (error) {
      request.log.error({ err: error }, "Failed to create workspace")
      const message = error instanceof Error ? error.message : "Failed to create workspace"
      reply.code(400).type("text/plain").send(message)
    }
  })

  app.get<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }
    return workspace
  })

  app.delete<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    await deps.workspaceManager.delete(request.params.id)
    reply.code(204)
  })

  app.get<{
    Params: { id: string }
    Querystring: { path?: string }
  }>("/api/workspaces/:id/files", async (request, reply) => {
    try {
      const query = WorkspaceFilesQuerySchema.parse(request.query ?? {})
      return deps.workspaceManager.listFiles(request.params.id, query.path ?? ".")
    } catch (error) {
      return handleWorkspaceError(error, reply)
    }
  })

  app.get<{
    Params: { id: string }
    Querystring: { q?: string; limit?: string; type?: "all" | "file" | "directory"; refresh?: string }
  }>("/api/workspaces/:id/files/search", async (request, reply) => {
    try {
      const query = WorkspaceFileSearchQuerySchema.parse(request.query ?? {})
      return deps.workspaceManager.searchFiles(request.params.id, query.q, {
        limit: query.limit,
        type: query.type,
        refresh: query.refresh,
      })
    } catch (error) {
      return handleWorkspaceError(error, reply)
    }
  })

  app.get<{
    Params: { id: string }
    Querystring: { path?: string }
  }>("/api/workspaces/:id/files/content", async (request, reply) => {
    try {
      const query = WorkspaceFileContentQuerySchema.parse(request.query ?? {})
      return deps.workspaceManager.readFile(request.params.id, query.path)
    } catch (error) {
      return handleWorkspaceError(error, reply)
    }
  })

  app.get<{ Params: { id: string } }>("/api/workspaces/:id/git/status", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const result = spawnSync("git", ["-C", workspace.path, "status", "--porcelain=v1", "-b"], { encoding: "utf8" })
    if (result.error) {
      return {
        isRepo: false,
        branch: null,
        ahead: 0,
        behind: 0,
        changes: [],
        error: result.error.message,
      }
    }

    if (result.status !== 0) {
      const stderr = (result.stderr || "").toLowerCase()
      if (stderr.includes("not a git repository")) {
        return { isRepo: false, branch: null, ahead: 0, behind: 0, changes: [] }
      }
      reply.code(400)
      return {
        isRepo: false,
        branch: null,
        ahead: 0,
        behind: 0,
        changes: [],
        error: result.stderr || "Unable to read git status",
      }
    }

    const lines = (result.stdout || "").split(/\r?\n/).filter((line) => line.trim().length > 0)
    let branch: string | null = null
    let ahead = 0
    let behind = 0
    const changes: Array<{ path: string; status: string }> = []

    for (const line of lines) {
      if (line.startsWith("##")) {
        const header = line.replace(/^##\s*/, "")
        const [branchPart, trackingPart] = header.split("...")
        branch = branchPart?.trim() || null
        const tracking = trackingPart || ""
        const aheadMatch = tracking.match(/ahead\s+(\d+)/)
        const behindMatch = tracking.match(/behind\s+(\d+)/)
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0
        behind = behindMatch ? Number(behindMatch[1]) : 0
        continue
      }

      const status = line.slice(0, 2).trim() || line.slice(0, 2)
      const path = line.slice(3).trim()
      changes.push({ path, status })
    }

    return { isRepo: true, branch, ahead, behind, changes }
  })

  app.post<{
    Params: { id: string }
    Body: { destination: string; includeConfig?: boolean }
  }>("/api/workspaces/:id/export", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const payload = request.body ?? { destination: "" }
    const destination = payload.destination?.trim()
    if (!destination) {
      reply.code(400)
      return { error: "Destination is required" }
    }

    const exportRoot = path.join(destination, `nomadarch-export-${path.basename(workspace.path)}-${Date.now()}`)
    mkdirSync(exportRoot, { recursive: true })

    const workspaceTarget = path.join(exportRoot, "workspace")
    await cp(workspace.path, workspaceTarget, { recursive: true, force: true })

    const instanceData = await deps.instanceStore.read(workspace.path)
    await writeFile(path.join(exportRoot, "instance-data.json"), JSON.stringify(instanceData, null, 2), "utf-8")

    const configDir = getWorkspaceOpencodeConfigDir(workspace.id)
    if (existsSync(configDir)) {
      await cp(configDir, path.join(exportRoot, "opencode-config"), { recursive: true, force: true })
    }

    if (payload.includeConfig) {
      const config = deps.configStore.get()
      await writeFile(path.join(exportRoot, "user-config.json"), JSON.stringify(config, null, 2), "utf-8")
    }

    const metadata = {
      exportedAt: new Date().toISOString(),
      workspacePath: workspace.path,
      workspaceId: workspace.id,
    }
    await writeFile(path.join(exportRoot, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8")

    return { destination: exportRoot }
  })

  app.get<{ Params: { id: string } }>("/api/workspaces/:id/mcp-config", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const configPath = path.join(workspace.path, ".mcp.json")
    if (!existsSync(configPath)) {
      return { path: configPath, exists: false, config: { mcpServers: {} } }
    }

    try {
      const raw = await readFile(configPath, "utf-8")
      const parsed = raw ? JSON.parse(raw) : {}
      return { path: configPath, exists: true, config: parsed }
    } catch (error) {
      request.log.error({ err: error }, "Failed to read MCP config")
      reply.code(500)
      return { error: "Failed to read MCP config" }
    }
  })

  app.put<{ Params: { id: string } }>("/api/workspaces/:id/mcp-config", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const body = request.body as { config?: unknown }
    if (!body || typeof body.config !== "object" || body.config === null) {
      reply.code(400)
      return { error: "Invalid MCP config payload" }
    }

    const configPath = path.join(workspace.path, ".mcp.json")
    try {
      await writeFile(configPath, JSON.stringify(body.config, null, 2), "utf-8")
      return { path: configPath, exists: true, config: body.config }
    } catch (error) {
      request.log.error({ err: error }, "Failed to write MCP config")
      reply.code(500)
      return { error: "Failed to write MCP config" }
    }
  })

  app.post<{
    Params: { id: string }
    Body: { name: string; description?: string; systemPrompt: string; mode?: string }
  }>("/api/workspaces/:id/agents", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const { name, description, systemPrompt } = request.body
    if (!name || !systemPrompt) {
      reply.code(400)
      return { error: "Name and systemPrompt are required" }
    }

    try {
      const data = await deps.instanceStore.read(workspace.path)
      const customAgents = data.customAgents || []

      // Update existing or add new
      const existingIndex = customAgents.findIndex(a => a.name === name)
      const agentData = { name, description, prompt: systemPrompt }

      if (existingIndex >= 0) {
        customAgents[existingIndex] = agentData
      } else {
        customAgents.push(agentData)
      }

      await deps.instanceStore.write(workspace.path, {
        ...data,
        customAgents
      })

      return { success: true, agent: agentData }
    } catch (error) {
      request.log.error({ err: error }, "Failed to save custom agent")
      reply.code(500)
      return { error: "Failed to save custom agent" }
    }
  })

  app.post<{
    Body: { source: string; destination: string; includeConfig?: boolean }
  }>("/api/workspaces/import", async (request, reply) => {
    const payload = request.body ?? { source: "", destination: "" }
    const source = payload.source?.trim()
    const destination = payload.destination?.trim()
    if (!source || !destination) {
      reply.code(400)
      return { error: "Source and destination are required" }
    }

    const workspaceSource = path.join(source, "workspace")
    if (!existsSync(workspaceSource)) {
      reply.code(400)
      return { error: "Export workspace folder not found" }
    }

    await cp(workspaceSource, destination, { recursive: true, force: true })

    const workspace = await deps.workspaceManager.create(destination)

    const instanceDataPath = path.join(source, "instance-data.json")
    if (existsSync(instanceDataPath)) {
      const raw = await readFile(instanceDataPath, "utf-8")
      await deps.instanceStore.write(workspace.path, JSON.parse(raw))
    }

    const configSource = path.join(source, "opencode-config")
    if (existsSync(configSource)) {
      const configTarget = getWorkspaceOpencodeConfigDir(workspace.id)
      await cp(configSource, configTarget, { recursive: true, force: true })
    }

    if (payload.includeConfig) {
      const userConfigPath = path.join(source, "user-config.json")
      if (existsSync(userConfigPath)) {
        const raw = await readFile(userConfigPath, "utf-8")
        deps.configStore.replace(JSON.parse(raw))
      }
    }

    return workspace
  })

  // Serve static files from workspace for preview
  app.get<{ Params: { id: string; "*": string } }>("/api/workspaces/:id/serve/*", async (request, reply) => {
    const workspace = deps.workspaceManager.get(request.params.id)
    if (!workspace) {
      reply.code(404)
      return { error: "Workspace not found" }
    }

    const relativePath = request.params["*"]
    const filePath = path.join(workspace.path, relativePath)

    // Security check: ensure file is within workspace.path
    if (!filePath.startsWith(workspace.path)) {
      reply.code(403)
      return { error: "Access denied" }
    }

    if (!existsSync(filePath)) {
      reply.code(404)
      return { error: "File not found" }
    }

    const stat = await readFileStat(filePath)
    if (!stat.isFile()) {
      reply.code(400)
      return { error: "Not a file" }
    }

    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".htm": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".txt": "text/plain",
    }

    reply.type(mimeTypes[ext] || "application/octet-stream")
    return await readFile(filePath)
  })
}


function handleWorkspaceError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message === "Workspace not found") {
    reply.code(404)
    return { error: "Workspace not found" }
  }
  reply.code(400)
  return { error: error instanceof Error ? error.message : "Unable to fulfill request" }
}
