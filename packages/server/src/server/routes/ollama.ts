import { FastifyInstance, FastifyReply } from "fastify"
import {
  OllamaCloudClient,
  type OllamaCloudConfig,
  type ChatRequest,
  type EmbeddingRequest,
  type ToolDefinition
} from "../../integrations/ollama-cloud"
import { Logger } from "../../logger"
import fs from "fs"
import path from "path"
import { getUserIntegrationsDir } from "../../user-data"

const CONFIG_DIR = getUserIntegrationsDir()
const CONFIG_FILE = path.join(CONFIG_DIR, "ollama-config.json")

interface OllamaRouteDeps {
  logger: Logger
}

export async function registerOllamaRoutes(
  app: FastifyInstance,
  deps: OllamaRouteDeps
) {
  const logger = deps.logger.child({ component: "ollama-routes" })

  app.get('/api/ollama/config', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      return { config: { ...config, apiKey: config.apiKey ? '***' : undefined } }
    } catch (error) {
      logger.error({ error }, "Failed to get Ollama config")
      return reply.status(500).send({ error: "Failed to get Ollama configuration" })
    }
  })

  app.post('/api/ollama/config', {
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          apiKey: { type: 'string' },
          endpoint: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { enabled, apiKey, endpoint } = request.body as any
      updateOllamaConfig({ enabled, apiKey, endpoint })
      logger.info("Ollama Cloud configuration updated")
      return { success: true, config: { enabled, endpoint, apiKey: apiKey ? '***' : undefined } }
    } catch (error) {
      logger.error({ error }, "Failed to update Ollama config")
      return reply.status(500).send({ error: "Failed to update Ollama configuration" })
    }
  })

  app.post('/api/ollama/test', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const isConnected = await client.testConnection()

      return { connected: isConnected }
    } catch (error) {
      logger.error({ error }, "Ollama Cloud connection test failed")
      return reply.status(500).send({ error: "Connection test failed" })
    }
  })

  app.get('/api/ollama/models', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      logger.info({ endpoint: config.endpoint, hasApiKey: !!config.apiKey }, "Fetching Ollama models")

      const client = new OllamaCloudClient(config)
      const models = await client.listModels()

      logger.info({ modelCount: models.length }, "Ollama models fetched successfully")
      return { models }
    } catch (error: any) {
      logger.error({ error: error?.message || error }, "Failed to list Ollama models")
      return reply.status(500).send({ error: error?.message || "Failed to list models" })
    }
  })

  app.get('/api/ollama/models/cloud', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const cloudModels = await client.getCloudModels()

      return { models: cloudModels }
    } catch (error) {
      logger.error({ error }, "Failed to list cloud models")
      return reply.status(500).send({ error: "Failed to list cloud models" })
    }
  })

  app.get('/api/ollama/models/thinking', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const thinkingModels = await client.getThinkingCapableModels()

      return { models: thinkingModels }
    } catch (error) {
      logger.error({ error }, "Failed to list thinking models")
      return reply.status(500).send({ error: "Failed to list thinking models" })
    }
  })

  app.get('/api/ollama/models/vision', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const visionModels = await client.getVisionCapableModels()

      return { models: visionModels }
    } catch (error) {
      logger.error({ error }, "Failed to list vision models")
      return reply.status(500).send({ error: "Failed to list vision models" })
    }
  })

  app.get('/api/ollama/models/embedding', async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const embeddingModels = await client.getEmbeddingModels()

      return { models: embeddingModels }
    } catch (error) {
      logger.error({ error }, "Failed to list embedding models")
      return reply.status(500).send({ error: "Failed to list embedding models" })
    }
  })

  app.post('/api/ollama/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string' }
              }
            }
          },
          stream: { type: 'boolean' },
          think: { type: ['boolean', 'string'] },
          format: { type: ['string', 'object'] },
          tools: { type: 'array' },
          web_search: { type: 'boolean' },
          options: {
            type: 'object',
            properties: {
              temperature: { type: 'number', minimum: 0, maximum: 2 },
              top_p: { type: 'number', minimum: 0, maximum: 1 }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const chatRequest = request.body as ChatRequest

      if (chatRequest.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        try {
          const stream = await client.chat(chatRequest)

          for await (const chunk of stream) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)

            if (chunk.done) {
              reply.raw.write('data: [DONE]\n\n')
              break
            }
          }

          reply.raw.end()
        } catch (streamError: any) {
          logger.error({ error: streamError?.message || streamError }, "Ollama streaming failed")
          // Send error event to client so it knows the request failed
          reply.raw.write(`data: ${JSON.stringify({ error: streamError?.message || "Streaming failed" })}\n\n`)
          reply.raw.write('data: [DONE]\n\n')
          reply.raw.end()
        }
      } else {
        const stream = await client.chat(chatRequest)
        const chunks: any[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks[chunks.length - 1]
      }
    } catch (error) {
      logger.error({ error }, "Ollama chat request failed")
      return reply.status(500).send({ error: "Chat request failed" })
    }
  })

  app.post('/api/ollama/chat/thinking', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array' },
          stream: { type: 'boolean' },
          think: { type: ['boolean', 'string'] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const chatRequest = request.body as ChatRequest
      chatRequest.think = chatRequest.think ?? true

      if (chatRequest.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        try {
          const stream = await client.chatWithThinking(chatRequest)

          for await (const chunk of stream) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)

            if (chunk.done) {
              reply.raw.write('data: [DONE]\n\n')
              break
            }
          }

          reply.raw.end()
        } catch (streamError) {
          logger.error({ error: streamError }, "Thinking streaming failed")
          reply.raw.end()
        }
      } else {
        const stream = await client.chatWithThinking(chatRequest)
        const chunks: any[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks[chunks.length - 1]
      }
    } catch (error) {
      logger.error({ error }, "Ollama thinking chat request failed")
      return reply.status(500).send({ error: "Thinking chat request failed" })
    }
  })

  app.post('/api/ollama/chat/vision', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages', 'images'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array' },
          images: { type: 'array', items: { type: 'string' } },
          stream: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const { model, messages, images, stream } = request.body as any
      const chatRequest: ChatRequest = { model, messages, stream: stream ?? false }

      if (chatRequest.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        try {
          const streamResult = await client.chatWithVision(chatRequest, images)

          for await (const chunk of streamResult) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)

            if (chunk.done) {
              reply.raw.write('data: [DONE]\n\n')
              break
            }
          }

          reply.raw.end()
        } catch (streamError) {
          logger.error({ error: streamError }, "Vision streaming failed")
          reply.raw.end()
        }
      } else {
        const streamResult = await client.chatWithVision(chatRequest, images)
        const chunks: any[] = []
        for await (const chunk of streamResult) {
          chunks.push(chunk)
        }
        return chunks[chunks.length - 1]
      }
    } catch (error) {
      logger.error({ error }, "Ollama vision chat request failed")
      return reply.status(500).send({ error: "Vision chat request failed" })
    }
  })

  app.post('/api/ollama/chat/tools', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages', 'tools'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array' },
          tools: { type: 'array' },
          stream: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const { model, messages, tools, stream } = request.body as any
      const chatRequest: ChatRequest = { model, messages, stream: stream ?? false }

      if (chatRequest.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        try {
          const streamResult = await client.chatWithTools(chatRequest, tools)

          for await (const chunk of streamResult) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)

            if (chunk.done) {
              reply.raw.write('data: [DONE]\n\n')
              break
            }
          }

          reply.raw.end()
        } catch (streamError) {
          logger.error({ error: streamError }, "Tools streaming failed")
          reply.raw.end()
        }
      } else {
        const streamResult = await client.chatWithTools(chatRequest, tools)
        const chunks: any[] = []
        for await (const chunk of streamResult) {
          chunks.push(chunk)
        }
        return chunks[chunks.length - 1]
      }
    } catch (error) {
      logger.error({ error }, "Ollama tools chat request failed")
      return reply.status(500).send({ error: "Tools chat request failed" })
    }
  })

  app.post('/api/ollama/chat/websearch', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array' },
          stream: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const chatRequest = request.body as ChatRequest

      if (chatRequest.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        try {
          const stream = await client.chatWithWebSearch(chatRequest)

          for await (const chunk of stream) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)

            if (chunk.done) {
              reply.raw.write('data: [DONE]\n\n')
              break
            }
          }

          reply.raw.end()
        } catch (streamError) {
          logger.error({ error: streamError }, "Web search streaming failed")
          reply.raw.end()
        }
      } else {
        const stream = await client.chatWithWebSearch(chatRequest)
        const chunks: any[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks[chunks.length - 1]
      }
    } catch (error) {
      logger.error({ error }, "Ollama web search chat request failed")
      return reply.status(500).send({ error: "Web search chat request failed" })
    }
  })

  app.post('/api/ollama/embeddings', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'input'],
        properties: {
          model: { type: 'string' },
          input: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const embedRequest = request.body as EmbeddingRequest

      const result = await client.generateEmbeddings(embedRequest)
      return result
    } catch (error) {
      logger.error({ error }, "Ollama embeddings request failed")
      return reply.status(500).send({ error: "Embeddings request failed" })
    }
  })

  app.post('/api/ollama/pull', {
    schema: {
      body: {
        type: 'object',
        required: ['model'],
        properties: {
          model: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const config = getOllamaConfig()
      if (!config.enabled) {
        return reply.status(400).send({ error: "Ollama Cloud is not enabled" })
      }

      const client = new OllamaCloudClient(config)
      const { model } = request.body as any

      client.pullModel(model).catch(error => {
        logger.error({ error, model }, "Failed to pull model")
      })

      return { message: `Started pulling model: ${model}` }
    } catch (error) {
      logger.error({ error }, "Failed to initiate model pull")
      return reply.status(500).send({ error: "Failed to start model pull" })
    }
  })

  logger.info("Ollama Cloud routes registered")
}

function getOllamaConfig(): OllamaCloudConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { enabled: false, endpoint: "https://ollama.com" }
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { enabled: false, endpoint: "https://ollama.com" }
  }
}

function updateOllamaConfig(config: Partial<OllamaCloudConfig>): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    const current = getOllamaConfig()

    // Only update apiKey if a new non-empty value is provided
    const updated = {
      ...current,
      ...config,
      // Preserve existing apiKey if new one is undefined/empty
      apiKey: config.apiKey || current.apiKey
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2))
    console.log(`[Ollama] Config saved: enabled=${updated.enabled}, endpoint=${updated.endpoint}, hasApiKey=${!!updated.apiKey}`)
  } catch (error) {
    console.error("Failed to save Ollama config:", error)
  }
}
