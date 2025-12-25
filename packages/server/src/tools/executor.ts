/**
 * Tool Executor Service
 * Provides MCP-compatible tool definitions and execution for all AI models.
 * This enables Z.AI, Qwen, OpenCode Zen, etc. to write files, read files, and interact with the workspace.
 */

import fs from "fs"
import path from "path"
import { createLogger } from "../logger"
import { getMcpManager } from "../mcp/client"

const log = createLogger({ component: "tool-executor" })

// OpenAI-compatible Tool Definition Schema
export interface ToolDefinition {
    type: "function"
    function: {
        name: string
        description: string
        parameters: {
            type: "object"
            properties: Record<string, { type: string; description?: string }>
            required?: string[]
        }
    }
}

// Tool Call from LLM Response
export interface ToolCall {
    id: string
    type: "function"
    function: {
        name: string
        arguments: string // JSON string
    }
}

// Tool Execution Result
export interface ToolResult {
    tool_call_id: string
    role: "tool"
    content: string
}

/**
 * Core Tool Definitions for MCP
 * These follow OpenAI's function calling schema (compatible with Z.AI GLM-4)
 */
export const CORE_TOOLS: ToolDefinition[] = [
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Write content to a file in the workspace. Creates the file if it doesn't exist, or overwrites if it does. Use this to generate code files, configuration, or any text content.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file within the workspace (e.g., 'src/components/Button.tsx')"
                    },
                    content: {
                        type: "string",
                        description: "The full content to write to the file"
                    }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the contents of a file from the workspace.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file within the workspace"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_files",
            description: "List files and directories in a workspace directory.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the directory (use '.' for root)"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_directory",
            description: "Create a directory in the workspace. Creates parent directories if needed.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the directory to create"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_file",
            description: "Delete a file from the workspace.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file to delete"
                    }
                },
                required: ["path"]
            }
        }
    }
]

/**
 * Execute a tool call within a workspace context
 */
export async function executeTool(
    workspacePath: string,
    toolCall: ToolCall
): Promise<ToolResult> {
    const { id, function: fn } = toolCall
    const name = fn.name
    let args: Record<string, unknown>

    try {
        args = JSON.parse(fn.arguments)
    } catch (e) {
        return {
            tool_call_id: id,
            role: "tool",
            content: `Error: Failed to parse tool arguments: ${fn.arguments}`
        }
    }

    log.info({ tool: name, args, workspacePath }, "Executing tool")

    try {
        switch (name) {
            case "write_file": {
                const relativePath = String(args.path || "")
                const content = String(args.content || "")
                const fullPath = path.resolve(workspacePath, relativePath)

                // Security check: ensure we're still within workspace
                if (!fullPath.startsWith(path.resolve(workspacePath))) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Path escapes workspace boundary: ${relativePath}`
                    }
                }

                // Ensure parent directory exists
                const dir = path.dirname(fullPath)
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true })
                }

                fs.writeFileSync(fullPath, content, "utf-8")
                log.info({ path: relativePath, bytes: content.length }, "File written successfully")
                return {
                    tool_call_id: id,
                    role: "tool",
                    content: `Successfully wrote ${content.length} bytes to ${relativePath}`
                }
            }

            case "read_file": {
                const relativePath = String(args.path || "")
                const fullPath = path.resolve(workspacePath, relativePath)

                if (!fullPath.startsWith(path.resolve(workspacePath))) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Path escapes workspace boundary: ${relativePath}`
                    }
                }

                if (!fs.existsSync(fullPath)) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: File not found: ${relativePath}`
                    }
                }

                const content = fs.readFileSync(fullPath, "utf-8")
                return {
                    tool_call_id: id,
                    role: "tool",
                    content: content.slice(0, 50000) // Limit to prevent context overflow
                }
            }

            case "list_files": {
                const relativePath = String(args.path || ".")
                const fullPath = path.resolve(workspacePath, relativePath)

                if (!fullPath.startsWith(path.resolve(workspacePath))) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Path escapes workspace boundary: ${relativePath}`
                    }
                }

                if (!fs.existsSync(fullPath)) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Directory not found: ${relativePath}`
                    }
                }

                const entries = fs.readdirSync(fullPath, { withFileTypes: true })
                const listing = entries.map(e =>
                    e.isDirectory() ? `${e.name}/` : e.name
                ).join("\n")

                return {
                    tool_call_id: id,
                    role: "tool",
                    content: listing || "(empty directory)"
                }
            }

            case "create_directory": {
                const relativePath = String(args.path || "")
                const fullPath = path.resolve(workspacePath, relativePath)

                if (!fullPath.startsWith(path.resolve(workspacePath))) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Path escapes workspace boundary: ${relativePath}`
                    }
                }

                fs.mkdirSync(fullPath, { recursive: true })
                return {
                    tool_call_id: id,
                    role: "tool",
                    content: `Successfully created directory: ${relativePath}`
                }
            }

            case "delete_file": {
                const relativePath = String(args.path || "")
                const fullPath = path.resolve(workspacePath, relativePath)

                if (!fullPath.startsWith(path.resolve(workspacePath))) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: Path escapes workspace boundary: ${relativePath}`
                    }
                }

                if (!fs.existsSync(fullPath)) {
                    return {
                        tool_call_id: id,
                        role: "tool",
                        content: `Error: File not found: ${relativePath}`
                    }
                }

                fs.unlinkSync(fullPath)
                return {
                    tool_call_id: id,
                    role: "tool",
                    content: `Successfully deleted: ${relativePath}`
                }
            }

            default: {
                // Check if this is an MCP tool (format: mcp_servername_toolname)
                if (name.startsWith("mcp_")) {
                    try {
                        const mcpManager = getMcpManager()
                        const result = await mcpManager.executeTool(name, args)
                        return {
                            tool_call_id: id,
                            role: "tool",
                            content: result
                        }
                    } catch (mcpError) {
                        const message = mcpError instanceof Error ? mcpError.message : String(mcpError)
                        return {
                            tool_call_id: id,
                            role: "tool",
                            content: `MCP tool error: ${message}`
                        }
                    }
                }

                return {
                    tool_call_id: id,
                    role: "tool",
                    content: `Error: Unknown tool: ${name}`
                }
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error({ tool: name, error: message }, "Tool execution failed")
        return {
            tool_call_id: id,
            role: "tool",
            content: `Error executing ${name}: ${message}`
        }
    }
}

/**
 * Execute multiple tool calls in parallel
 */
export async function executeTools(
    workspacePath: string,
    toolCalls: ToolCall[]
): Promise<ToolResult[]> {
    return Promise.all(
        toolCalls.map(tc => executeTool(workspacePath, tc))
    )
}
