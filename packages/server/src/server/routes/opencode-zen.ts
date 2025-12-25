import { FastifyInstance } from "fastify"
import { OpenCodeZenClient, type ChatRequest, getDefaultZenConfig, type ChatMessage } from "../../integrations/opencode-zen"
import { Logger } from "../../logger"
import { CORE_TOOLS, executeTools, type ToolCall, type ToolResult } from "../../tools/executor"
import { getMcpManager } from "../../mcp/client"

interface OpenCodeZenRouteDeps {
    logger: Logger
}

// Maximum number of tool execution loops
const MAX_TOOL_LOOPS = 10

export async function registerOpenCodeZenRoutes(
    app: FastifyInstance,
    deps: OpenCodeZenRouteDeps
) {
    const logger = deps.logger.child({ component: "opencode-zen-routes" })

    // Create shared client
    const client = new OpenCodeZenClient(getDefaultZenConfig())

    // List available free Zen models
    app.get('/api/opencode-zen/models', async (request, reply) => {
        try {
            const models = await client.getModels()

            return {
                models: models.map(m => ({
                    id: m.id,
                    name: m.name,
                    family: m.family,
                    provider: "opencode-zen",
                    free: true,
                    reasoning: m.reasoning,
                    tool_call: m.tool_call,
                    limit: m.limit
                }))
            }
        } catch (error) {
            logger.error({ error }, "Failed to list OpenCode Zen models")
            return reply.status(500).send({ error: "Failed to list models" })
        }
    })

    // Test connection
    app.get('/api/opencode-zen/test', async (request, reply) => {
        try {
            const connected = await client.testConnection()
            return { connected }
        } catch (error) {
            logger.error({ error }, "OpenCode Zen connection test failed")
            return reply.status(500).send({ error: "Connection test failed" })
        }
    })

    // Chat completion endpoint WITH MCP TOOL SUPPORT
    app.post('/api/opencode-zen/chat', async (request, reply) => {
        try {
            const chatRequest = request.body as ChatRequest & {
                workspacePath?: string
                enableTools?: boolean
            }

            // Extract workspace path for tool execution
            const workspacePath = chatRequest.workspacePath || process.cwd()
            const enableTools = chatRequest.enableTools !== false

            logger.info({
                workspacePath,
                receivedWorkspacePath: chatRequest.workspacePath,
                enableTools
            }, "OpenCode Zen chat request received")

            // Handle streaming with tool loop
            if (chatRequest.stream) {
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                })

                try {
                    await streamWithToolLoop(
                        client,
                        chatRequest,
                        workspacePath,
                        enableTools,
                        reply.raw,
                        logger
                    )
                    reply.raw.end()
                } catch (streamError) {
                    logger.error({ error: streamError }, "OpenCode Zen streaming failed")
                    reply.raw.write(`data: ${JSON.stringify({ error: String(streamError) })}\n\n`)
                    reply.raw.end()
                }
            } else {
                // Non-streaming with tool loop
                const response = await chatWithToolLoop(
                    client,
                    chatRequest,
                    workspacePath,
                    enableTools,
                    logger
                )
                return response
            }
        } catch (error) {
            logger.error({ error }, "OpenCode Zen chat request failed")
            return reply.status(500).send({ error: "Chat request failed" })
        }
    })

    logger.info("OpenCode Zen routes registered with MCP tool support - Free models available!")
}

/**
 * Streaming chat with tool execution loop
 */
async function streamWithToolLoop(
    client: OpenCodeZenClient,
    request: ChatRequest,
    workspacePath: string,
    enableTools: boolean,
    rawResponse: any,
    logger: Logger
): Promise<void> {
    let messages = [...request.messages]
    let loopCount = 0

    // Load MCP tools from workspace config
    let allTools = [...CORE_TOOLS]
    if (enableTools && workspacePath) {
        try {
            const mcpManager = getMcpManager()
            await mcpManager.loadConfig(workspacePath)
            const mcpTools = await mcpManager.getToolsAsOpenAIFormat()
            allTools = [...CORE_TOOLS, ...mcpTools]
            if (mcpTools.length > 0) {
                logger.info({ mcpToolCount: mcpTools.length }, "Loaded MCP tools for OpenCode Zen")
            }
        } catch (mcpError) {
            logger.warn({ error: mcpError }, "Failed to load MCP tools")
        }
    }

    // Inject tools if enabled
    const requestWithTools: ChatRequest = {
        ...request,
        tools: enableTools ? allTools : undefined,
        tool_choice: enableTools ? "auto" : undefined
    }

    while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++

        // Accumulate tool calls from stream
        let accumulatedToolCalls: { [index: number]: { id: string; name: string; arguments: string } } = {}
        let hasToolCalls = false
        let textContent = ""

        // Stream response
        for await (const chunk of client.chatStream({ ...requestWithTools, messages })) {
            // Write chunk to client
            rawResponse.write(`data: ${JSON.stringify(chunk)}\n\n`)

            const choice = chunk.choices[0]
            if (!choice) continue

            // Accumulate text content
            if (choice.delta?.content) {
                textContent += choice.delta.content
            }

            // Accumulate tool calls from delta (if API supports it)
            const deltaToolCalls = (choice.delta as any)?.tool_calls
            if (deltaToolCalls) {
                hasToolCalls = true
                for (const tc of deltaToolCalls) {
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
        const assistantMessage: ChatMessage = {
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
            const toolMessage: ChatMessage = {
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
    client: OpenCodeZenClient,
    request: ChatRequest,
    workspacePath: string,
    enableTools: boolean,
    logger: Logger
): Promise<any> {
    let messages = [...request.messages]
    let loopCount = 0
    let lastResponse: any = null

    // Inject tools if enabled
    const requestWithTools: ChatRequest = {
        ...request,
        tools: enableTools ? CORE_TOOLS : undefined,
        tool_choice: enableTools ? "auto" : undefined
    }

    while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++

        const response = await client.chat({ ...requestWithTools, messages, stream: false })
        lastResponse = response

        const choice = response.choices[0]
        if (!choice) break

        const toolCalls = (choice.message as any)?.tool_calls

        // If no tool calls, return
        if (!toolCalls || toolCalls.length === 0 || !enableTools) {
            return response
        }

        logger.info({ toolCalls: toolCalls.map((tc: any) => tc.function.name) }, "Executing tool calls")

        // Add assistant message
        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: (choice.message as any).content || undefined,
            tool_calls: toolCalls
        }
        messages.push(assistantMessage)

        // Execute tools
        const toolResults = await executeTools(workspacePath, toolCalls)

        // Add tool results
        for (const result of toolResults) {
            const toolMessage: ChatMessage = {
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
