import { z } from "zod"
import { createHmac } from "crypto"

export const ZAIConfigSchema = z.object({
    apiKey: z.string().optional(),
    endpoint: z.string().default("https://api.z.ai/api/coding/paas/v4"),
    enabled: z.boolean().default(false),
    timeout: z.number().default(300000)
})

export type ZAIConfig = z.infer<typeof ZAIConfigSchema>

export const ZAIMessageSchema = z.object({
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

export type ZAIMessage = z.infer<typeof ZAIMessageSchema>

// Tool Definition Schema (OpenAI-compatible)
export const ZAIToolSchema = z.object({
    type: z.literal("function"),
    function: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
            type: z.literal("object"),
            properties: z.record(z.object({
                type: z.string(),
                description: z.string().optional()
            })),
            required: z.array(z.string()).optional()
        })
    })
})

export type ZAITool = z.infer<typeof ZAIToolSchema>

export const ZAIChatRequestSchema = z.object({
    model: z.string().default("glm-4.7"),
    messages: z.array(ZAIMessageSchema),
    max_tokens: z.number().default(8192),
    stream: z.boolean().default(true),
    temperature: z.number().optional(),
    tools: z.array(ZAIToolSchema).optional(),
    tool_choice: z.union([
        z.literal("auto"),
        z.literal("none"),
        z.object({
            type: z.literal("function"),
            function: z.object({ name: z.string() })
        })
    ]).optional(),
    thinking: z.object({
        type: z.enum(["enabled", "disabled"]).optional()
    }).optional()
})

export type ZAIChatRequest = z.infer<typeof ZAIChatRequestSchema>

export const ZAIChatResponseSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(z.object({
        index: z.number(),
        message: z.object({
            role: z.string(),
            content: z.string().optional().nullable(),
            reasoning_content: z.string().optional(),
            tool_calls: z.array(z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                    name: z.string(),
                    arguments: z.string()
                })
            })).optional()
        }),
        finish_reason: z.string()
    })),
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number()
    })
})

export type ZAIChatResponse = z.infer<typeof ZAIChatResponseSchema>

export const ZAIStreamChunkSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(z.object({
        index: z.number(),
        delta: z.object({
            role: z.string().optional(),
            content: z.string().optional().nullable(),
            reasoning_content: z.string().optional(),
            tool_calls: z.array(z.object({
                index: z.number().optional(),
                id: z.string().optional(),
                type: z.literal("function").optional(),
                function: z.object({
                    name: z.string().optional(),
                    arguments: z.string().optional()
                }).optional()
            })).optional()
        }),
        finish_reason: z.string().nullable().optional()
    }))
})

export type ZAIStreamChunk = z.infer<typeof ZAIStreamChunkSchema>

export const ZAI_MODELS = [
    "glm-4.7",
    "glm-4.6",
    "glm-4.5",
    "glm-4.5-air",
    "glm-4.5-flash",
    "glm-4.5-long"
] as const

export type ZAIModelName = typeof ZAI_MODELS[number]

export class ZAIClient {
    private config: ZAIConfig
    private baseUrl: string

    constructor(config: ZAIConfig) {
        this.config = config
        this.baseUrl = config.endpoint.replace(/\/$/, "")
    }

    async testConnection(): Promise<boolean> {
        if (!this.config.apiKey) {
            return false
        }

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify({
                    model: "glm-4.7",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "test" }]
                })
            })

            if (!response.ok) {
                const text = await response.text()
                console.error(`Z.AI connection failed (${response.status}): ${text}`)
            }

            return response.ok
        } catch (error) {
            console.error("Z.AI connection test failed:", error)
            return false
        }
    }

    async listModels(): Promise<string[]> {
        return [...ZAI_MODELS]
    }

    async *chatStream(request: ZAIChatRequest): AsyncGenerator<ZAIStreamChunk> {
        if (!this.config.apiKey) {
            throw new Error("Z.AI API key is required")
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify({
                ...request,
                stream: true
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Z.AI API error (${response.status}): ${errorText}`)
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
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim()
                        if (data === "[DONE]") return

                        try {
                            const parsed = JSON.parse(data)
                            yield parsed as ZAIStreamChunk
                        } catch (e) {
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }
    }

    async chat(request: ZAIChatRequest): Promise<ZAIChatResponse> {
        if (!this.config.apiKey) {
            throw new Error("Z.AI API key is required")
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify({
                ...request,
                stream: false
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Z.AI API error (${response.status}): ${errorText}`)
        }

        return await response.json()
    }

    private getHeaders(): Record<string, string> {
        const token = this.generateToken(this.config.apiKey!)
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        }
    }

    private generateToken(apiKey: string, expiresIn: number = 3600): string {
        try {
            const [id, secret] = apiKey.split(".")
            if (!id || !secret) return apiKey // Fallback or handle error

            const now = Date.now()
            const payload = {
                api_key: id,
                exp: now + expiresIn * 1000,
                timestamp: now
            }

            const header = {
                alg: "HS256",
                sign_type: "SIGN"
            }

            const base64UrlEncode = (obj: any) => {
                return Buffer.from(JSON.stringify(obj))
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '')
            }

            const encodedHeader = base64UrlEncode(header)
            const encodedPayload = base64UrlEncode(payload)

            const signature = createHmac("sha256", secret)
                .update(`${encodedHeader}.${encodedPayload}`)
                .digest("base64")
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '')

            return `${encodedHeader}.${encodedPayload}.${signature}`
        } catch (e) {
            console.warn("Failed to generate JWT, using raw key", e)
            return apiKey
        }
    }

    static validateApiKey(apiKey: string): boolean {
        return typeof apiKey === "string" && apiKey.length > 0
    }
}