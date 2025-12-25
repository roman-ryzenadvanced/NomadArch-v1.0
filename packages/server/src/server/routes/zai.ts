import { FastifyInstance } from "fastify"
import { ZAIClient, ZAI_MODELS, type ZAIConfig, type ZAIChatRequest, type ZAIMessage } from "../../integrations/zai-api"
import { Logger } from "../../logger"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { getUserIntegrationsDir } from "../../user-data"
import { CORE_TOOLS, executeTools, type ToolCall, type ToolResult } from "../../tools/executor"
import { getMcpManager } from "../../mcp/client"

interface ZAIRouteDeps {
    logger: Logger
}

const CONFIG_DIR = getUserIntegrationsDir()
const CONFIG_FILE = join(CONFIG_DIR, "zai-config.json")

// Maximum number of tool execution loops to prevent infinite recursion
const MAX_TOOL_LOOPS = 10

export async function registerZAIRoutes(
    app: FastifyInstance,
    deps: ZAIRouteDeps
) {
    const logger = deps.logger.child({ component: "zai-routes" })

    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true })
    }

    // Get Z.AI configuration
    app.get('/api/zai/config', async (request, reply) => {
        try {
            const config = getZAIConfig()
            return { config: { ...config, apiKey: config.apiKey ? '***' : undefined } }
        } catch (error) {
            logger.error({ error }, "Failed to get Z.AI config")
            return reply.status(500).send({ error: "Failed to get Z.AI configuration" })
        }
    })

    // Update Z.AI configuration
    app.post('/api/zai/config', async (request, reply) => {
        try {
            const { enabled, apiKey, endpoint } = request.body as Partial<ZAIConfig>
            updateZAIConfig({ enabled, apiKey, endpoint })
            logger.info("Z.AI configuration updated")
            return { success: true, config: { enabled, endpoint, apiKey: apiKey ? '***' : undefined } }
        } catch (error) {
            logger.error({ error }, "Failed to update Z.AI config")
            return reply.status(500).send({ error: "Failed to update Z.AI configuration" })
        }
    })

    // Test Z.AI connection
    app.post('/api/zai/test', async (request, reply) => {
        try {
            const config = getZAIConfig()
            if (!config.enabled) {
                return reply.status(400).send({ error: "Z.AI is not enabled" })
            }

            const client = new ZAIClient(config)
            const isConnected = await client.testConnection()

            return { connected: isConnected }
        } catch (error) {
            logger.error({ error }, "Z.AI connection test failed")
            return reply.status(500).send({ error: "Connection test failed" })
        }
    })

    // List available models
    app.get('/api/zai/models', async (request, reply) => {
        try {
            return { models: ZAI_MODELS.map(name => ({ name, provider: "zai" })) }
        } catch (error) {
            logger.error({ error }, "Failed to list Z.AI models")
            return reply.status(500).send({ error: "Failed to list models" })
        }
    })

    // Chat completion endpoint WITH MCP TOOL SUPPORT
    app.post('/api/zai/chat', async (request, reply) => {
        try {
            const config = getZAIConfig()
            if (!config.enabled) {
                return reply.status(400).send({ error: "Z.AI is not enabled" })
            }

            const client = new ZAIClient(config)
            const chatRequest = request.body as ZAIChatRequest & {
                workspacePath?: string
                enableTools?: boolean
            }

            // Extract workspace path for tool execution
            // IMPORTANT: workspacePath must be provided by frontend, otherwise tools write to server directory
            const workspacePath = chatRequest.workspacePath || process.cwd()
            const enableTools = chatRequest.enableTools !== false // Default to true

            logger.info({
                workspacePath,
                receivedWorkspacePath: chatRequest.workspacePath,
                enableTools
            }, "Z.AI chat request received")

            // Load MCP tools from workspace config
            let allTools = [...CORE_TOOLS]
            if (enableTools && workspacePath) {
                try {
                    const mcpManager = getMcpManager()
                    await mcpManager.loadConfig(workspacePath)
                    const mcpTools = await mcpManager.getToolsAsOpenAIFormat()
                    allTools = [...CORE_TOOLS, ...mcpTools]
                    if (mcpTools.length > 0) {
                        logger.info({ mcpToolCount: mcpTools.length }, "Loaded MCP tools")
                    }
                } catch (mcpError) {
                    logger.warn({ error: mcpError }, "Failed to load MCP tools, using core tools only")
                }
            }

            // Inject tools into request if enabled
            const requestWithTools: ZAIChatRequest = {
                ...chatRequest,
                tools: enableTools ? allTools : undefined,
                tool_choice: enableTools ? "auto" : undefined
            }

            // Handle streaming with tool execution loop
            if (chatRequest.stream) {
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                })

                try {
                    await streamWithToolLoop(
                        client,
                        requestWithTools,
                        workspacePath,
                        enableTools,
                        reply.raw,
                        logger
                    )
                    reply.raw.end()
                } catch (streamError) {
                    logger.error({ error: streamError }, "Z.AI streaming failed")
                    reply.raw.write(`data: ${JSON.stringify({ error: String(streamError) })}\n\n`)
                    reply.raw.end()
                }
            } else {
                // Non-streaming with tool loop
                const response = await chatWithToolLoop(
                    client,
                    requestWithTools,
                    workspacePath,
                    enableTools,
                    logger
                )
                return response
            }
        } catch (error) {
            logger.error({ error }, "Z.AI chat request failed")
            return reply.status(500).send({ error: "Chat request failed" })
        }
    })

    logger.info("Z.AI routes registered with MCP tool support")
}

/**
 * Streaming chat with tool execution loop
 */
async function streamWithToolLoop(
    client: ZAIClient,
    request: ZAIChatRequest,
    workspacePath: string,
    enableTools: boolean,
    rawResponse: any,
    logger: Logger
): Promise<void> {
    let messages = [...request.messages]
    let loopCount = 0

    while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++

        // Accumulate tool calls from stream
        let accumulatedToolCalls: { [index: number]: { id: string; name: string; arguments: string } } = {}
        let hasToolCalls = false
        let textContent = ""

        // Stream response
        for await (const chunk of client.chatStream({ ...request, messages })) {
            // Write chunk to client
            rawResponse.write(`data: ${JSON.stringify(chunk)}\n\n`)

            const choice = chunk.choices[0]
            if (!choice) continue

            // Accumulate text content
            if (choice.delta?.content) {
                textContent += choice.delta.content
            }

            // Accumulate tool calls from delta
            if (choice.delta?.tool_calls) {
                hasToolCalls = true
                for (const tc of choice.delta.tool_calls) {
                    const idx = tc.index ?? 0
                    if (!accumulatedToolCalls[idx]) {
                        accumulatedToolCalls[idx] = { id: tc.id || "", name: "", arguments: "" }
                    }
                    if (tc.id) accumulatedToolCalls[idx].id = tc.id
                    if (tc.function?.name) accumulatedToolCalls[idx].name += tc.function.name
                    if (tc.function?.arguments) accumulatedToolCalls[idx].arguments += tc.function.arguments
                }
            }

            // Check if we should stop
            if (choice.finish_reason === "stop") {
                rawResponse.write('data: [DONE]\n\n')
                return
            }
        }

        // If no tool calls, we're done
        if (!hasToolCalls || !enableTools) {
            rawResponse.write('data: [DONE]\n\n')
            return
        }

        // Convert accumulated tool calls
        const toolCalls: ToolCall[] = Object.values(accumulatedToolCalls).map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: {
                name: tc.name,
                arguments: tc.arguments
            }
        }))

        if (toolCalls.length === 0) {
            rawResponse.write('data: [DONE]\n\n')
            return
        }

        logger.info({ toolCalls: toolCalls.map(tc => tc.function.name) }, "Executing tool calls")

        // Add assistant message with tool calls
        const assistantMessage: ZAIMessage = {
            role: "assistant",
            content: textContent || undefined,
            tool_calls: toolCalls
        }
        messages.push(assistantMessage)

        // Execute tools
        const toolResults = await executeTools(workspacePath, toolCalls)

        // Notify client about tool execution via special event
        for (const result of toolResults) {
            const toolEvent = {
                type: "tool_result",
                tool_call_id: result.tool_call_id,
                content: result.content
            }
            rawResponse.write(`data: ${JSON.stringify(toolEvent)}\n\n`)
        }

        // Add tool results to messages
        for (const result of toolResults) {
            const toolMessage: ZAIMessage = {
                role: "tool",
                content: result.content,
                tool_call_id: result.tool_call_id
            }
            messages.push(toolMessage)
        }

        logger.info({ loopCount, toolsExecuted: toolResults.length }, "Tool loop iteration complete")
    }

    logger.warn({ loopCount }, "Max tool loops reached")
    rawResponse.write('data: [DONE]\n\n')
}

/**
 * Non-streaming chat with tool execution loop
 */
async function chatWithToolLoop(
    client: ZAIClient,
    request: ZAIChatRequest,
    workspacePath: string,
    enableTools: boolean,
    logger: Logger
): Promise<any> {
    let messages = [...request.messages]
    let loopCount = 0
    let lastResponse: any = null

    while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++

        const response = await client.chat({ ...request, messages, stream: false })
        lastResponse = response

        const choice = response.choices[0]
        if (!choice) break

        const toolCalls = choice.message?.tool_calls

        // If no tool calls or finish_reason is "stop", return
        if (!toolCalls || toolCalls.length === 0 || !enableTools) {
            return response
        }

        logger.info({ toolCalls: toolCalls.map((tc: any) => tc.function.name) }, "Executing tool calls")

        // Add assistant message
        const assistantMessage: ZAIMessage = {
            role: "assistant",
            content: choice.message.content || undefined,
            tool_calls: toolCalls
        }
        messages.push(assistantMessage)

        // Execute tools
        const toolResults = await executeTools(workspacePath, toolCalls)

        // Add tool results
        for (const result of toolResults) {
            const toolMessage: ZAIMessage = {
                role: "tool",
                content: result.content,
                tool_call_id: result.tool_call_id
            }
            messages.push(toolMessage)
        }

        logger.info({ loopCount, toolsExecuted: toolResults.length }, "Tool loop iteration complete")
    }

    logger.warn({ loopCount }, "Max tool loops reached")
    return lastResponse
}

function getZAIConfig(): ZAIConfig {
    try {
        if (existsSync(CONFIG_FILE)) {
            const data = readFileSync(CONFIG_FILE, 'utf-8')
            return JSON.parse(data)
        }
        return { enabled: false, endpoint: "https://api.z.ai/api/coding/paas/v4", timeout: 300000 }
    } catch {
        return { enabled: false, endpoint: "https://api.z.ai/api/coding/paas/v4", timeout: 300000 }
    }
}

function updateZAIConfig(config: Partial<ZAIConfig>): void {
    const current = getZAIConfig()
    const updated = { ...current, ...config }
    writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2))
}
