import { z } from "zod"
import { getContextEngineService } from "../context-engine"

export const OllamaCloudConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpoint: z.string().default("https://ollama.com"),
  enabled: z.boolean().default(false)
})

export type OllamaCloudConfig = z.infer<typeof OllamaCloudConfigSchema>

// Schema is flexible since Ollama Cloud may return different fields than local Ollama
export const OllamaModelSchema = z.object({
  name: z.string(),
  model: z.string().optional(), // Some APIs return model instead of name
  size: z.union([z.string(), z.number()]).optional(),
  digest: z.string().optional(),
  modified_at: z.string().optional(),
  created_at: z.string().optional(),
  details: z.any().optional() // Model details like family, parameter_size, etc.
})

export type OllamaModel = z.infer<typeof OllamaModelSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  images: z.array(z.string()).optional(),
  tool_calls: z.array(z.any()).optional(),
  thinking: z.string().optional()
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any())
})

export type ToolCall = z.infer<typeof ToolCallSchema>

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.enum(["object", "string", "number", "boolean", "array"]),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional()
  })
})

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>

export const ChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  stream: z.boolean().default(false),
  think: z.union([z.boolean(), z.enum(["low", "medium", "high"])]).optional(),
  format: z.union([z.literal("json"), z.any()]).optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  web_search: z.boolean().optional(),
  options: z.object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional()
  }).optional()
})

export const ChatResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  message: ChatMessageSchema.extend({
    thinking: z.string().optional(),
    tool_calls: z.array(z.any()).optional()
  }),
  done: z.boolean().optional(),
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional()
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>

export const EmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string())])
})

export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>

export const EmbeddingResponseSchema = z.object({
  model: z.string(),
  embeddings: z.array(z.array(z.number()))
})

export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>

export class OllamaCloudClient {
  private config: OllamaCloudConfig
  private baseUrl: string

  constructor(config: OllamaCloudConfig) {
    this.config = config
    this.baseUrl = config.endpoint.replace(/\/$/, "")
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest("/tags", { method: "GET" })
      return response.ok
    } catch (error) {
      console.error("Ollama Cloud connection test failed:", error)
      return false
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const headers: Record<string, string> = {}
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`
      }

      const cloudResponse = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers
      })

      if (cloudResponse.ok) {
        const data = await cloudResponse.json()
        const modelsArray = Array.isArray(data?.data) ? data.data : []
        const parsedModels = modelsArray
          .map((model: any) => ({
            name: model.id || model.name || model.model,
            model: model.id || model.model || model.name,
          }))
          .filter((model: any) => model.name)

        if (parsedModels.length > 0) {
          return parsedModels
        }
      }

      const response = await this.makeRequest("/tags", { method: "GET" })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error")
        console.error(`[OllamaCloud] Failed to fetch models: ${response.status} ${response.statusText}`, errorText)
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()
      console.log("[OllamaCloud] Models response:", JSON.stringify(data).substring(0, 500))

      // Handle different response formats flexibly
      const modelsArray = Array.isArray(data.models) ? data.models :
        Array.isArray(data) ? data : []

      // Parse with flexible schema, don't throw on validation failure
      // Only include cloud-compatible models (ending in -cloud or known cloud models)
      const parsedModels: OllamaModel[] = []
      for (const model of modelsArray) {
        try {
          const modelName = model.name || model.model || ""
          // Filter to only cloud-compatible models
          const isCloudModel = modelName.endsWith("-cloud") ||
            modelName.includes(":cloud") ||
            modelName.startsWith("gpt-oss") ||
            modelName.startsWith("qwen3-coder") ||
            modelName.startsWith("deepseek-v3")

          if (modelName && isCloudModel) {
            parsedModels.push({
              name: modelName,
              model: model.model || modelName,
              size: model.size,
              digest: model.digest,
              modified_at: model.modified_at,
              created_at: model.created_at,
              details: model.details
            })
          }
        } catch (parseError) {
          console.warn("[OllamaCloud] Skipping model due to parse error:", model, parseError)
        }
      }

      console.log(`[OllamaCloud] Parsed ${parsedModels.length} cloud-compatible models`)
      return parsedModels
    } catch (error) {
      console.error("Failed to list Ollama Cloud models:", error)
      throw error
    }
  }

  async chat(request: ChatRequest): Promise<AsyncIterable<ChatResponse>> {
    if (!this.config.apiKey) {
      throw new Error("Ollama Cloud API key is required")
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    // Inject Context-Engine RAG context if available
    let enrichedRequest = request
    try {
      const contextEngine = getContextEngineService()
      if (contextEngine?.isReady()) {
        // Get the last user message for context retrieval
        const lastUserMessage = [...request.messages].reverse().find(m => m.role === "user")
        if (lastUserMessage?.content) {
          const contextBlock = await contextEngine.query(lastUserMessage.content, 4096)
          if (contextBlock) {
            // Clone messages and inject context into the last user message
            const messagesWithContext = request.messages.map((msg, index) => {
              if (msg === lastUserMessage) {
                return {
                  ...msg,
                  content: `${contextBlock}\n\n${msg.content}`
                }
              }
              return msg
            })
            enrichedRequest = { ...request, messages: messagesWithContext }
            console.log("[OllamaCloud] Context-Engine context injected")
          }
        }
      }
    } catch (contextError) {
      // Graceful fallback - continue without context if Context-Engine fails
      console.warn("[OllamaCloud] Context-Engine query failed, continuing without RAG context:", contextError)
    }

    try {
      const response = await this.makeRequest("/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(enrichedRequest)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Chat request failed: ${response.statusText} - ${errorText}`)
      }

      if (request.stream) {
        return this.parseStreamingResponse(response)
      } else {
        const data = ChatResponseSchema.parse(await response.json())
        return this.createAsyncIterable([data])
      }
    } catch (error) {
      console.error("Ollama Cloud chat request failed:", error)
      throw error
    }
  }

  async chatWithThinking(request: ChatRequest): Promise<AsyncIterable<ChatResponse>> {
    const requestWithThinking = {
      ...request,
      think: true
    }
    return this.chat(requestWithThinking)
  }

  async chatWithStructuredOutput(request: ChatRequest, schema: any): Promise<AsyncIterable<ChatResponse>> {
    const requestWithFormat = {
      ...request,
      format: schema
    }
    return this.chat(requestWithFormat)
  }

  async chatWithVision(request: ChatRequest, images: string[]): Promise<AsyncIterable<ChatResponse>> {
    if (!request.messages.length) {
      throw new Error("At least one message is required")
    }

    const messagesWithImages = [...request.messages]
    const lastUserMessage = messagesWithImages.slice().reverse().find(m => m.role === "user")

    if (lastUserMessage) {
      lastUserMessage.images = images
    }

    return this.chat({ ...request, messages: messagesWithImages })
  }

  async chatWithTools(request: ChatRequest, tools: ToolDefinition[]): Promise<AsyncIterable<ChatResponse>> {
    const requestWithTools = {
      ...request,
      tools
    }
    return this.chat(requestWithTools)
  }

  async chatWithWebSearch(request: ChatRequest): Promise<AsyncIterable<ChatResponse>> {
    const requestWithWebSearch = {
      ...request,
      web_search: true
    }
    return this.chat(requestWithWebSearch)
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.config.apiKey) {
      throw new Error("Ollama Cloud API key is required")
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    try {
      const response = await this.makeRequest("/embed", {
        method: "POST",
        headers,
        body: JSON.stringify(request)
      })

      if (!response.ok) {
        throw new Error(`Embeddings request failed: ${response.statusText}`)
      }

      const data = await response.json()
      return EmbeddingResponseSchema.parse(data)
    } catch (error) {
      console.error("Ollama Cloud embeddings request failed:", error)
      throw error
    }
  }

  async pullModel(modelName: string): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    const response = await this.makeRequest("/pull", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: modelName })
    })

    if (!response.ok) {
      throw new Error(`Failed to pull model ${modelName}: ${response.statusText}`)
    }
  }

  private async *parseStreamingResponse(response: Response): AsyncIterable<ChatResponse> {
    if (!response.body) {
      throw new Error("Response body is missing")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const STREAM_TIMEOUT_MS = 60000 // 60 second timeout per chunk
    let lastActivity = Date.now()

    const checkTimeout = () => {
      if (Date.now() - lastActivity > STREAM_TIMEOUT_MS) {
        reader.cancel().catch(() => { })
        throw new Error("Stream timeout - no data received for 60 seconds")
      }
    }

    try {
      while (true) {
        checkTimeout()

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Read timeout")), STREAM_TIMEOUT_MS)
        })

        // Race the read against the timeout
        let result: ReadableStreamReadResult<Uint8Array>
        try {
          result = await Promise.race([reader.read(), timeoutPromise])
        } catch (timeoutError) {
          reader.cancel().catch(() => { })
          throw new Error("Stream read timeout")
        }

        const { done, value } = result
        if (done) break

        lastActivity = Date.now()

        const lines = decoder.decode(value, { stream: true }).split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            const chatResponse = ChatResponseSchema.parse(data)
            yield chatResponse

            if (chatResponse.done) {
              return
            }
          } catch (parseError) {
            console.warn("Failed to parse streaming line:", line, parseError)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private async *createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item
    }
  }

  private async makeRequest(endpoint: string, options: RequestInit, timeoutMs: number = 120000): Promise<Response> {
    // Ensure endpoint starts with /api
    const apiEndpoint = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`
    const url = `${this.baseUrl}${apiEndpoint}`

    const headers: Record<string, string> = {
      ...options.headers as Record<string, string>
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    console.log(`[OllamaCloud] Making request to: ${url}`)

    // Add timeout to prevent indefinite hangs
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getCloudModels(): Promise<OllamaModel[]> {
    const allModels = await this.listModels()
    return allModels.filter(model => model.name.endsWith("-cloud"))
  }

  static validateApiKey(apiKey: string): boolean {
    return typeof apiKey === "string" && apiKey.length > 0
  }

  async getCloudModelNames(): Promise<string[]> {
    const cloudModels = await this.getCloudModels()
    return cloudModels.map(model => model.name)
  }

  async getThinkingCapableModels(): Promise<string[]> {
    const allModels = await this.listModels()
    const thinkingModelPatterns = ["qwen3", "deepseek-r1", "gpt-oss", "deepseek-v3.1"]
    return allModels
      .map(m => m.name)
      .filter(name => thinkingModelPatterns.some(pattern => name.toLowerCase().includes(pattern)))
  }

  async getVisionCapableModels(): Promise<string[]> {
    const allModels = await this.listModels()
    const visionModelPatterns = ["gemma3", "llama3.2-vision", "llava", "bakllava", "minicpm-v"]
    return allModels
      .map(m => m.name)
      .filter(name => visionModelPatterns.some(pattern => name.toLowerCase().includes(pattern)))
  }

  async getEmbeddingModels(): Promise<string[]> {
    const allModels = await this.listModels()
    const embeddingModelPatterns = ["embeddinggemma", "qwen3-embedding", "all-minilm", "nomic-embed", "mxbai-embed"]
    return allModels
      .map(m => m.name)
      .filter(name => embeddingModelPatterns.some(pattern => name.toLowerCase().includes(pattern)))
  }
}

export const DEFAULT_CLOUD_MODELS = [
  "gpt-oss:120b-cloud",
  "llama3.1:70b-cloud",
  "llama3.1:8b-cloud",
  "qwen2.5:32b-cloud",
  "qwen2.5:7b-cloud"
] as const

export type CloudModelName = typeof DEFAULT_CLOUD_MODELS[number]

export const THINKING_MODELS = [
  "qwen3",
  "deepseek-r1",
  "deepseek-v3.1",
  "gpt-oss:120b-cloud"
] as const

export type ThinkingModelName = typeof THINKING_MODELS[number]

export const VISION_MODELS = [
  "gemma3",
  "llava",
  "bakllava",
  "minicpm-v"
] as const

export type VisionModelName = typeof VISION_MODELS[number]

export const EMBEDDING_MODELS = [
  "embeddinggemma",
  "qwen3-embedding",
  "all-minilm",
  "nomic-embed-text",
  "mxbai-embed-large"
] as const

export type EmbeddingModelName = typeof EMBEDDING_MODELS[number]
