/**
 * OpenCode Zen API Integration
 * Provides direct access to OpenCode's free "Zen" models without requiring opencode.exe
 * Based on reverse-engineering the OpenCode source at https://github.com/sst/opencode
 * 
 * Free models (cost.input === 0) can be accessed with apiKey: "public"
 */

import { z } from "zod"

// Configuration schema for OpenCode Zen
export const OpenCodeZenConfigSchema = z.object({
    enabled: z.boolean().default(true), // Free models enabled by default
    endpoint: z.string().default("https://opencode.ai/zen/v1"),
    apiKey: z.string().optional()
})

export type OpenCodeZenConfig = z.infer<typeof OpenCodeZenConfigSchema>

// Model schema matching models.dev format
export const ZenModelSchema = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    attachment: z.boolean().optional(),
    temperature: z.boolean().optional(),
    cost: z.object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional()
    }).optional(),
    limit: z.object({
        context: z.number(),
        output: z.number()
    }).optional()
})

export type ZenModel = z.infer<typeof ZenModelSchema>

// Chat message schema (OpenAI-compatible)
export const ChatMessageSchema = z.object({
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string().optional(),
    tool_calls: z.array(z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
            name: z.string(),
            arguments: z.string()
        })
    })).optional(),
    tool_call_id: z.string().optional()
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

// Chat request schema
// Tool Definition Schema
export const ToolDefinitionSchema = z.object({
    type: z.literal("function"),
    function: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
            type: z.literal("object"),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional()
        })
    })
})

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>

export const ChatRequestSchema = z.object({
    model: z.string(),
    messages: z.array(ChatMessageSchema),
    stream: z.boolean().default(true),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    tools: z.array(ToolDefinitionSchema).optional(),
    tool_choice: z.union([
        z.literal("auto"),
        z.literal("none"),
        z.object({
            type: z.literal("function"),
            function: z.object({ name: z.string() })
        })
    ]).optional(),
    workspacePath: z.string().optional(),
    enableTools: z.boolean().optional()
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>

// Chat response chunk schema
export const ChatChunkSchema = z.object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: z.number().optional(),
    model: z.string().optional(),
    choices: z.array(z.object({
        index: z.number(),
        delta: z.object({
            role: z.string().optional(),
            content: z.string().optional()
        }).optional(),
        message: z.object({
            role: z.string(),
            content: z.string()
        }).optional(),
        finish_reason: z.string().nullable().optional()
    }))
})

export type ChatChunk = z.infer<typeof ChatChunkSchema>

// Known free OpenCode Zen models (cost.input === 0)
// From models.dev API - these are the free tier models
export const FREE_ZEN_MODELS: ZenModel[] = [
    {
        id: "gpt-5-nano",
        name: "GPT-5 Nano",
        family: "gpt-5-nano",
        reasoning: true,
        tool_call: true,
        attachment: true,
        temperature: false,
        cost: { input: 0, output: 0 },
        limit: { context: 400000, output: 128000 }
    },
    {
        id: "big-pickle",
        name: "Big Pickle",
        family: "pickle",
        reasoning: false,
        tool_call: true,
        attachment: false,
        temperature: true,
        cost: { input: 0, output: 0 },
        limit: { context: 200000, output: 128000 }
    },
    {
        id: "grok-code",
        name: "Grok Code Fast 1",
        family: "grok",
        reasoning: true,
        tool_call: true,
        attachment: false,
        temperature: true,
        cost: { input: 0, output: 0 },
        limit: { context: 256000, output: 256000 }
    },
    {
        id: "glm-4.7-free",
        name: "GLM-4.7",
        family: "glm-free",
        reasoning: true,
        tool_call: true,
        attachment: false,
        temperature: true,
        cost: { input: 0, output: 0 },
        limit: { context: 204800, output: 131072 }
    },
    {
        id: "alpha-doubao-seed-code",
        name: "Doubao Seed Code (alpha)",
        family: "doubao",
        reasoning: true,
        tool_call: true,
        attachment: false,
        temperature: true,
        cost: { input: 0, output: 0 },
        limit: { context: 256000, output: 32000 }
    }
]

export class OpenCodeZenClient {
    private config: OpenCodeZenConfig
    private baseUrl: string
    private modelsCache: ZenModel[] | null = null
    private modelsCacheTime: number = 0
    private readonly CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

    constructor(config?: Partial<OpenCodeZenConfig>) {
        this.config = OpenCodeZenConfigSchema.parse(config || {})
        this.baseUrl = this.config.endpoint.replace(/\/$/, "")
    }

    /**
     * Get free Zen models from OpenCode
     */
    async getModels(): Promise<ZenModel[]> {
        // Return cached models if still valid
        const now = Date.now()
        if (this.modelsCache && (now - this.modelsCacheTime) < this.CACHE_TTL_MS) {
            return this.modelsCache
        }

        try {
            // Try to fetch fresh models from models.dev
            const response = await fetch("https://models.dev/api.json", {
                headers: {
                    "User-Agent": "NomadArch/1.0"
                },
                signal: AbortSignal.timeout(10000)
            })

            if (response.ok) {
                const data = await response.json()
                // Extract OpenCode provider and filter free models
                const opencodeProvider = data["opencode"]
                if (opencodeProvider && opencodeProvider.models) {
                    const freeModels: ZenModel[] = []
                    for (const [id, model] of Object.entries(opencodeProvider.models)) {
                        const m = model as any
                        if (m.cost && m.cost.input === 0) {
                            freeModels.push({
                                id,
                                name: m.name,
                                family: m.family,
                                reasoning: m.reasoning,
                                tool_call: m.tool_call,
                                attachment: m.attachment,
                                temperature: m.temperature,
                                cost: m.cost,
                                limit: m.limit
                            })
                        }
                    }
                    if (freeModels.length > 0) {
                        this.modelsCache = freeModels
                        this.modelsCacheTime = now
                        return freeModels
                    }
                }
            }
        } catch (error) {
            console.warn("Failed to fetch models from models.dev, using fallback:", error)
        }

        // Fallback to hardcoded free models
        this.modelsCache = FREE_ZEN_MODELS
        this.modelsCacheTime = now
        return FREE_ZEN_MODELS
    }

    /**
     * Test connection to OpenCode Zen API
     */
    async testConnection(): Promise<boolean> {
        try {
            const models = await this.getModels()
            return models.length > 0
        } catch (error) {
            console.error("OpenCode Zen connection test failed:", error)
            return false
        }
    }

    /**
     * Chat completion (streaming)
     */
    async *chatStream(request: ChatRequest): AsyncGenerator<ChatChunk> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "NomadArch/1.0",
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "NomadArch"
        }
        if (this.config.apiKey) {
            headers["Authorization"] = `Bearer ${this.config.apiKey}`
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ...request,
                stream: true
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`OpenCode Zen API error (${response.status}): ${errorText}`)
        }

        if (!response.body) {
            throw new Error("Response body is missing")
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (trimmed.startsWith("data: ")) {
                        const data = trimmed.slice(6)
                        if (data === "[DONE]") return

                        try {
                            const parsed = JSON.parse(data)
                            yield parsed as ChatChunk

                            // Check for finish
                            if (parsed.choices?.[0]?.finish_reason) {
                                return
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }
    }

    /**
     * Chat completion (non-streaming)
     */
    async chat(request: ChatRequest): Promise<ChatChunk> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "NomadArch/1.0",
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "NomadArch"
        }
        if (this.config.apiKey) {
            headers["Authorization"] = `Bearer ${this.config.apiKey}`
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ...request,
                stream: false
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`OpenCode Zen API error (${response.status}): ${errorText}`)
        }

        return await response.json()
    }
}

export function getDefaultZenConfig(): OpenCodeZenConfig {
    return {
        enabled: true,
        endpoint: "https://opencode.ai/zen/v1"
    }
}
