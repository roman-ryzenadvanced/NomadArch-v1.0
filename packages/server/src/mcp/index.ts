/**
 * MCP Module Index
 * Exports MCP client and manager for external MCP server integration.
 */

export {
    McpClient,
    McpManager,
    getMcpManager,
    resetMcpManager,
    type McpServerConfig,
    type McpToolDefinition,
    type McpToolCall,
    type McpToolResult
} from "./client"
