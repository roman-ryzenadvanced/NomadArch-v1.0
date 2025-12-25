import { FastifyInstance, FastifyReply } from "fastify"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { Logger } from "../../logger"
import { CORE_TOOLS, executeTools, type ToolCall, type ToolResult } from "../../tools/executor"
import { getMcpManager } from "../../mcp/client"

interface QwenRouteDeps {
  logger: Logger
}

const MAX_TOOL_LOOPS = 10

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai'
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion'
const QWEN_OAUTH_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const QWEN_DEFAULT_RESOURCE_URL = 'https://dashscope.aliyuncs.com/compatible-mode'

function normalizeQwenModel(model?: string): string {
  const raw = (model || "").trim()
  if (!raw) return "coder-model"
  const lower = raw.toLowerCase()
  if (lower === "vision-model" || lower.includes("vision")) return "vision-model"
  if (lower === "coder-model") return "coder-model"
  if (lower.includes("coder")) return "coder-model"
  return "coder-model"
}

function normalizeQwenResourceUrl(resourceUrl?: string): string {
  const raw = typeof resourceUrl === 'string' && resourceUrl.trim().length > 0
    ? resourceUrl.trim()
    : QWEN_DEFAULT_RESOURCE_URL
  const withProtocol = raw.startsWith('http') ? raw : `https://${raw}`
  const trimmed = withProtocol.replace(/\/$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export async function registerQwenRoutes(
  app: FastifyInstance,
  deps: QwenRouteDeps
) {
  const logger = deps.logger.child({ component: "qwen-routes" })

  // Qwen OAuth Device Flow: request device authorization
  app.post('/api/qwen/oauth/device', {
    schema: {
      body: {
        type: 'object',
        required: ['code_challenge', 'code_challenge_method'],
        properties: {
          code_challenge: { type: 'string' },
          code_challenge_method: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { code_challenge, code_challenge_method } = request.body as any
      const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          client_id: QWEN_OAUTH_CLIENT_ID,
          scope: QWEN_OAUTH_SCOPE,
          code_challenge,
          code_challenge_method
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error({ status: response.status, errorText }, "Qwen device authorization failed")
        return reply.status(response.status).send({ error: "Device authorization failed", details: errorText })
      }

      const data = await response.json()
      return { ...data }
    } catch (error) {
      logger.error({ error }, "Failed to request Qwen device authorization")
      return reply.status(500).send({ error: "Device authorization failed" })
    }
  })

  // Qwen OAuth Device Flow: poll token endpoint
  app.post('/api/qwen/oauth/token', {
    schema: {
      body: {
        type: 'object',
        required: ['device_code', 'code_verifier'],
        properties: {
          device_code: { type: 'string' },
          code_verifier: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { device_code, code_verifier } = request.body as any
      const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: QWEN_OAUTH_DEVICE_GRANT_TYPE,
          client_id: QWEN_OAUTH_CLIENT_ID,
          device_code,
          code_verifier
        })
      })

      const responseText = await response.text()
      if (!response.ok) {
        logger.error({ status: response.status, responseText }, "Qwen device token poll failed")
        return reply.status(response.status).send(responseText)
      }
      try {
        return reply.send(JSON.parse(responseText))
      } catch {
        return reply.send(responseText)
      }
    } catch (error) {
      logger.error({ error }, "Failed to poll Qwen token endpoint")
      return reply.status(500).send({ error: "Token polling failed" })
    }
  })

  // Qwen OAuth refresh token
  app.post('/api/qwen/oauth/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { refresh_token } = request.body as any
      const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: QWEN_OAUTH_CLIENT_ID
        })
      })

      const responseText = await response.text()
      if (!response.ok) {
        logger.error({ status: response.status, responseText }, "Qwen token refresh failed")
        return reply.status(response.status).send(responseText)
      }

      try {
        return reply.send(JSON.parse(responseText))
      } catch {
        return reply.send(responseText)
      }
    } catch (error) {
      logger.error({ error }, "Failed to refresh Qwen token")
      return reply.status(500).send({ error: "Token refresh failed" })
    }
  })

  // Get user info
  app.get('/api/qwen/user', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: "Authorization required" })
      }

      const token = authHeader.substring(7)
      const userResponse = await fetch('https://chat.qwen.ai/api/v1/user', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!userResponse.ok) {
        return reply.status(401).send({ error: "Invalid token" })
      }

      const userData = await userResponse.json()
      return { user: userData }
    } catch (error) {
      logger.error({ error }, "Failed to fetch Qwen user info")
      return reply.status(500).send({ error: "Failed to fetch user info" })
    }
  })

  /**
   * Streaming chat with tool execution loop for Qwen
   */
  async function streamWithToolLoop(
    accessToken: string,
    chatUrl: string,
    initialRequest: any,
    workspacePath: string,
    enableTools: boolean,
    rawResponse: any,
    logger: Logger
  ) {
    let messages = [...initialRequest.messages]
    let loopCount = 0
    const model = initialRequest.model

    while (loopCount < MAX_TOOL_LOOPS) {
      loopCount++
      logger.info({ loopCount, model }, "Starting Qwen tool loop iteration")

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          ...initialRequest,
          messages,
          stream: true,
          tools: enableTools ? initialRequest.tools : undefined,
          tool_choice: enableTools ? "auto" : undefined
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Qwen API error (${response.status}): ${errorText}`)
      }

      if (!response.body) throw new Error("No response body")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let textContent = ""
      let hasToolCalls = false
      let accumulatedToolCalls: Record<number, { id: string, name: string, arguments: string }> = {}
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data: ")) continue
          const data = trimmed.slice(6).trim()
          if (data === "[DONE]") {
            if (!hasToolCalls) {
              rawResponse.write('data: [DONE]\n\n')
              return
            }
            break
          }

          let chunk: any
          try {
            chunk = JSON.parse(data)
          } catch (e) {
            continue
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue

          // Pass through text content to client
          if (choice.delta?.content) {
            textContent += choice.delta.content
            rawResponse.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }

          // Accumulate tool calls
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

          if (choice.finish_reason === "tool_calls") {
            break
          }

          if (choice.finish_reason === "stop" && !hasToolCalls) {
            rawResponse.write('data: [DONE]\n\n')
            return
          }
        }
      }

      // If no tool calls, we're done
      if (!hasToolCalls || !enableTools) {
        rawResponse.write('data: [DONE]\n\n')
        return
      }

      // Execute tools
      const toolCalls: ToolCall[] = Object.values(accumulatedToolCalls).map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))

      logger.info({ toolCalls: toolCalls.map(tc => tc.function.name) }, "Executing Qwen tool calls")

      messages.push({
        role: "assistant",
        content: textContent || undefined,
        tool_calls: toolCalls
      })

      const toolResults = await executeTools(workspacePath, toolCalls)

      // Notify frontend
      for (const result of toolResults) {
        const toolEvent = {
          type: "tool_result",
          tool_call_id: result.tool_call_id,
          content: result.content
        }
        rawResponse.write(`data: ${JSON.stringify(toolEvent)}\n\n`)
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: result.tool_call_id
        })
      }
    }

    rawResponse.write('data: [DONE]\n\n')
  }

  // Qwen Chat API - with tool support
  app.post('/api/qwen/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array' },
          stream: { type: 'boolean' },
          resource_url: { type: 'string' },
          workspacePath: { type: 'string' },
          enableTools: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: "Authorization required" })
      }

      const accessToken = authHeader.substring(7)
      const { model, messages, stream, resource_url, workspacePath, enableTools } = request.body as any

      const apiBaseUrl = normalizeQwenResourceUrl(resource_url)
      const normalizedModel = normalizeQwenModel(model)
      const chatUrl = `${apiBaseUrl}/chat/completions`

      // MCP Tool Loading
      let allTools = [...CORE_TOOLS]
      const effectiveWorkspacePath = workspacePath || process.cwd()
      const toolsEnabled = enableTools !== false

      if (toolsEnabled && effectiveWorkspacePath) {
        try {
          const mcpManager = getMcpManager()
          await mcpManager.loadConfig(effectiveWorkspacePath)
          const mcpTools = await mcpManager.getToolsAsOpenAIFormat()
          allTools = [...CORE_TOOLS, ...mcpTools]
        } catch (mcpError) {
          logger.warn({ error: mcpError }, "Failed to load MCP tools for Qwen")
        }
      }

      logger.info({ chatUrl, model: normalizedModel, tools: allTools.length }, "Proxying Qwen chat with tools")

      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        await streamWithToolLoop(
          accessToken,
          chatUrl,
          { model: normalizedModel, messages, tools: allTools },
          effectiveWorkspacePath,
          toolsEnabled,
          reply.raw,
          logger
        )
      } else {
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            model: normalizedModel,
            messages,
            stream: false
          })
        })
        const data = await response.json()
        return reply.send(data)
      }
    } catch (error) {
      logger.error({ error }, "Qwen chat proxy failed")
      return reply.status(500).send({ error: "Chat request failed" })
    }
  })

  // Qwen Models list endpoint
  app.get('/api/qwen/models', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: "Authorization required" })
      }

      const accessToken = authHeader.substring(7)
      const resourceUrl = (request.query as any).resource_url || 'https://chat.qwen.ai'
      const modelsUrl = `${resourceUrl}/api/v1/models`

      const response = await fetch(modelsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error({ status: response.status, errorText }, "Qwen models request failed")
        return reply.status(response.status).send({ error: "Models request failed", details: errorText })
      }

      const data = await response.json()
      return reply.send(data)
    } catch (error) {
      logger.error({ error }, "Qwen models request failed")
      return reply.status(500).send({ error: "Models request failed" })
    }
  })

  logger.info("Qwen OAuth routes registered")
}
