/**
 * MCP Client - Connects to MCP (Model Context Protocol) servers
 * and provides tool discovery and execution capabilities.
 * 
 * Supports:
 * - stdio-based MCP servers (command + args)
 * - HTTP/SSE-based remote MCP servers
 */

import { spawn, ChildProcess } from "child_process"
import { createLogger } from "../logger"
import path from "path"

const log = createLogger({ component: "mcp-client" })

// MCP Protocol Types
export interface McpServerConfig {
    command?: string
    args?: string[]
    env?: Record<string, string>
    type?: "stdio" | "remote" | "http" | "sse" | "streamable-http"
    url?: string
    headers?: Record<string, string>
}

export interface McpToolDefinition {
    name: string
    description: string
    inputSchema: {
        type: "object"
        properties: Record<string, { type: string; description?: string }>
        required?: string[]
    }
}

export interface McpToolCall {
    name: string
    arguments: Record<string, unknown>
}

export interface McpToolResult {
    content: Array<{
        type: "text" | "image" | "resource"
        text?: string
        data?: string
        mimeType?: string
    }>
    isError?: boolean
}

// MCP JSON-RPC Message Types
interface JsonRpcRequest {
    jsonrpc: "2.0"
    id: number | string
    method: string
    params?: unknown
}

interface JsonRpcResponse {
    jsonrpc: "2.0"
    id: number | string
    result?: unknown
    error?: { code: number; message: string; data?: unknown }
}

/**
 * MCP Client for a single server
 */
export class McpClient {
    private config: McpServerConfig
    private process: ChildProcess | null = null
    private messageId = 0
    private pendingRequests: Map<number | string, {
        resolve: (value: unknown) => void
        reject: (reason: unknown) => void
    }> = new Map()
    private buffer = ""
    private tools: McpToolDefinition[] = []
    private connected = false
    private serverName: string

    constructor(serverName: string, config: McpServerConfig) {
        this.serverName = serverName
        this.config = config
    }

    /**
     * Start and connect to the MCP server
     */
    async connect(): Promise<void> {
        if (this.connected) return

        if (this.config.type === "remote" || this.config.type === "http" || this.config.type === "sse") {
            // HTTP-based server - just mark as connected
            this.connected = true
            log.info({ server: this.serverName, type: this.config.type }, "Connected to remote MCP server")
            return
        }

        // Stdio-based server
        if (!this.config.command) {
            throw new Error(`MCP server ${this.serverName} has no command configured`)
        }

        log.info({ server: this.serverName, command: this.config.command, args: this.config.args }, "Starting MCP server")

        this.process = spawn(this.config.command, this.config.args || [], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ...this.config.env },
            shell: true
        })

        this.process.stdout?.on("data", (data) => this.handleData(data.toString()))
        this.process.stderr?.on("data", (data) => log.warn({ server: this.serverName }, `MCP stderr: ${data}`))
        this.process.on("error", (err) => log.error({ server: this.serverName, error: err }, "MCP process error"))
        this.process.on("exit", (code) => {
            log.info({ server: this.serverName, code }, "MCP process exited")
            this.connected = false
        })

        // Wait for process to start
        await new Promise(resolve => setTimeout(resolve, 500))

        // Initialize the server
        try {
            await this.sendRequest("initialize", {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                clientInfo: { name: "NomadArch", version: "0.4.0" }
            })

            await this.sendRequest("notifications/initialized", {})
            this.connected = true
            log.info({ server: this.serverName }, "MCP server initialized")
        } catch (error) {
            log.error({ server: this.serverName, error }, "Failed to initialize MCP server")
            this.disconnect()
            throw error
        }
    }

    /**
     * Disconnect from the MCP server
     */
    disconnect(): void {
        if (this.process) {
            this.process.kill()
            this.process = null
        }
        this.connected = false
        this.tools = []
        this.pendingRequests.clear()
    }

    /**
     * List available tools from this MCP server
     */
    async listTools(): Promise<McpToolDefinition[]> {
        if (!this.connected) {
            await this.connect()
        }

        if (this.config.type === "remote" || this.config.type === "http") {
            // For HTTP servers, fetch tools via HTTP
            return this.fetchToolsHttp()
        }

        try {
            const response = await this.sendRequest("tools/list", {}) as { tools?: McpToolDefinition[] }
            this.tools = response.tools || []
            return this.tools
        } catch (error) {
            log.error({ server: this.serverName, error }, "Failed to list MCP tools")
            return []
        }
    }

    /**
     * Execute a tool on this MCP server
     */
    async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.connected) {
            await this.connect()
        }

        log.info({ server: this.serverName, tool: name, args }, "Executing MCP tool")

        if (this.config.type === "remote" || this.config.type === "http") {
            return this.executeToolHttp(name, args)
        }

        try {
            const response = await this.sendRequest("tools/call", { name, arguments: args }) as McpToolResult
            return response
        } catch (error) {
            log.error({ server: this.serverName, tool: name, error }, "MCP tool execution failed")
            return {
                content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true
            }
        }
    }

    /**
     * Send a JSON-RPC request to the MCP server
     */
    private async sendRequest(method: string, params?: unknown): Promise<unknown> {
        if (!this.process?.stdin) {
            throw new Error("MCP server not running")
        }

        const id = ++this.messageId
        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params
        }

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject })

            const message = JSON.stringify(request) + "\n"
            this.process!.stdin!.write(message)

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id)
                    reject(new Error(`MCP request timeout: ${method}`))
                }
            }, 30000)
        })
    }

    /**
     * Handle incoming data from the MCP server
     */
    private handleData(data: string): void {
        this.buffer += data
        const lines = this.buffer.split("\n")
        this.buffer = lines.pop() || ""

        for (const line of lines) {
            if (!line.trim()) continue
            try {
                const message = JSON.parse(line) as JsonRpcResponse
                if (message.id !== undefined && this.pendingRequests.has(message.id)) {
                    const pending = this.pendingRequests.get(message.id)!
                    this.pendingRequests.delete(message.id)

                    if (message.error) {
                        pending.reject(new Error(message.error.message))
                    } else {
                        pending.resolve(message.result)
                    }
                }
            } catch (e) {
                log.warn({ server: this.serverName }, `Failed to parse MCP message: ${line}`)
            }
        }
    }

    /**
     * Fetch tools from HTTP-based MCP server
     */
    private async fetchToolsHttp(): Promise<McpToolDefinition[]> {
        if (!this.config.url) return []

        try {
            const response = await fetch(`${this.config.url}/tools/list`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...this.config.headers
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const data = await response.json() as JsonRpcResponse
            const result = data.result as { tools?: McpToolDefinition[] }
            return result.tools || []
        } catch (error) {
            log.error({ server: this.serverName, error }, "Failed to fetch HTTP MCP tools")
            return []
        }
    }

    /**
     * Execute tool on HTTP-based MCP server
     */
    private async executeToolHttp(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.config.url) {
            return { content: [{ type: "text", text: "No URL configured" }], isError: true }
        }

        try {
            const response = await fetch(`${this.config.url}/tools/call`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...this.config.headers
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/call",
                    params: { name, arguments: args }
                })
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const data = await response.json() as JsonRpcResponse
            return data.result as McpToolResult
        } catch (error) {
            return {
                content: [{ type: "text", text: `HTTP error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true
            }
        }
    }

    isConnected(): boolean {
        return this.connected
    }

    getServerName(): string {
        return this.serverName
    }
}

/**
 * MCP Manager - Manages multiple MCP server connections
 */
export class McpManager {
    private clients: Map<string, McpClient> = new Map()
    private configPath: string | null = null

    /**
     * Load MCP config from a workspace
     */
    async loadConfig(workspacePath: string): Promise<void> {
        const configPath = path.join(workspacePath, ".mcp.json")
        this.configPath = configPath

        try {
            const fs = await import("fs")
            if (!fs.existsSync(configPath)) {
                log.info({ path: configPath }, "No MCP config found")
                return
            }

            const content = fs.readFileSync(configPath, "utf-8")
            const config = JSON.parse(content) as { mcpServers?: Record<string, McpServerConfig> }

            if (config.mcpServers) {
                for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
                    this.addServer(name, serverConfig)
                }
            }

            log.info({ servers: Object.keys(config.mcpServers || {}) }, "Loaded MCP config")
        } catch (error) {
            log.error({ path: configPath, error }, "Failed to load MCP config")
        }
    }

    /**
     * Add an MCP server
     */
    addServer(name: string, config: McpServerConfig): void {
        if (this.clients.has(name)) {
            this.clients.get(name)!.disconnect()
        }
        this.clients.set(name, new McpClient(name, config))
        log.info({ server: name }, "Added MCP server")
    }

    /**
     * Remove an MCP server
     */
    removeServer(name: string): void {
        const client = this.clients.get(name)
        if (client) {
            client.disconnect()
            this.clients.delete(name)
        }
    }

    /**
     * Get all available tools from all connected servers
     */
    async getAllTools(): Promise<Array<McpToolDefinition & { serverName: string }>> {
        const allTools: Array<McpToolDefinition & { serverName: string }> = []

        for (const [name, client] of this.clients) {
            try {
                const tools = await client.listTools()
                for (const tool of tools) {
                    allTools.push({ ...tool, serverName: name })
                }
            } catch (error) {
                log.warn({ server: name, error }, "Failed to get tools from MCP server")
            }
        }

        return allTools
    }

    /**
     * Convert MCP tools to OpenAI-compatible format
     */
    async getToolsAsOpenAIFormat(): Promise<Array<{
        type: "function"
        function: {
            name: string
            description: string
            parameters: McpToolDefinition["inputSchema"]
        }
    }>> {
        const mcpTools = await this.getAllTools()

        return mcpTools.map(tool => ({
            type: "function" as const,
            function: {
                // Prefix with server name to avoid conflicts
                name: `mcp_${tool.serverName}_${tool.name}`,
                description: `[MCP: ${tool.serverName}] ${tool.description}`,
                parameters: tool.inputSchema
            }
        }))
    }

    /**
     * Execute a tool by its full name (mcp_servername_toolname)
     */
    async executeTool(fullName: string, args: Record<string, unknown>): Promise<string> {
        // Parse mcp_servername_toolname format
        const match = fullName.match(/^mcp_([^_]+)_(.+)$/)
        if (!match) {
            return `Error: Invalid MCP tool name format: ${fullName}`
        }

        const [, serverName, toolName] = match
        const client = this.clients.get(serverName)

        if (!client) {
            return `Error: MCP server not found: ${serverName}`
        }

        const result = await client.executeTool(toolName, args)

        // Convert result to string
        const texts = result.content
            .filter(c => c.type === "text" && c.text)
            .map(c => c.text!)

        return texts.join("\n") || (result.isError ? "Tool execution failed" : "Tool executed successfully")
    }

    /**
     * Disconnect all servers
     */
    disconnectAll(): void {
        for (const client of this.clients.values()) {
            client.disconnect()
        }
        this.clients.clear()
    }

    /**
     * Get status of all servers
     */
    getStatus(): Record<string, { connected: boolean }> {
        const status: Record<string, { connected: boolean }> = {}
        for (const [name, client] of this.clients) {
            status[name] = { connected: client.isConnected() }
        }
        return status
    }
}

// Singleton instance
let globalMcpManager: McpManager | null = null

export function getMcpManager(): McpManager {
    if (!globalMcpManager) {
        globalMcpManager = new McpManager()
    }
    return globalMcpManager
}

export function resetMcpManager(): void {
    if (globalMcpManager) {
        globalMcpManager.disconnectAll()
        globalMcpManager = null
    }
}
