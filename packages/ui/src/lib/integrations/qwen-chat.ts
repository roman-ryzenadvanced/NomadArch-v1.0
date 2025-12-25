/**
 * Qwen OAuth Chat Service
 * Routes chat requests through the Qwen API using OAuth tokens
 * Based on the qwen-code implementation from QwenLM/qwen-code
 */

import { getUserScopedKey } from "../user-storage"

const QWEN_TOKEN_STORAGE_KEY = 'qwen_oauth_token'
const DEFAULT_QWEN_ENDPOINT = 'https://dashscope-intl.aliyuncs.com'

export interface QwenToken {
    access_token: string
    token_type: string
    expires_in: number
    refresh_token?: string
    resource_url?: string
    created_at: number
}

export interface QwenChatMessage {
    role: 'user' | 'assistant' | 'system'
    content: string
}

export interface QwenChatRequest {
    model: string
    messages: QwenChatMessage[]
    stream?: boolean
    temperature?: number
    max_tokens?: number
}

export interface QwenChatResponse {
    id: string
    object: string
    created: number
    model: string
    choices: Array<{
        index: number
        message: {
            role: string
            content: string
        }
        finish_reason: string | null
    }>
    usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    }
}

export interface QwenStreamChunk {
    id: string
    object: string
    created: number
    model: string
    choices: Array<{
        index: number
        delta: {
            role?: string
            content?: string
        }
        finish_reason: string | null
    }>
}

/**
 * Get stored Qwen OAuth token from localStorage
 */
export function getStoredQwenToken(): QwenToken | null {
    try {
        const stored = localStorage.getItem(getUserScopedKey(QWEN_TOKEN_STORAGE_KEY))
        return stored ? JSON.parse(stored) : null
    } catch {
        return null
    }
}

/**
 * Check if Qwen OAuth token is valid and not expired
 */
export function isQwenTokenValid(token: QwenToken | null): boolean {
    if (!token || !token.access_token) return false

    const createdAt = token.created_at > 1e12 ? Math.floor(token.created_at / 1000) : token.created_at
    const expiresAt = (createdAt + token.expires_in) * 1000 - 300000 // 5 min buffer
    return Date.now() < expiresAt
}

/**
 * Get the API endpoint URL for Qwen
 * Uses resource_url from token if available, otherwise falls back to default
 */
export function getQwenEndpoint(token: QwenToken | null): string {
    const baseEndpoint = token?.resource_url || DEFAULT_QWEN_ENDPOINT

    // Normalize URL: add protocol if missing
    const normalizedUrl = baseEndpoint.startsWith('http')
        ? baseEndpoint
        : `https://${baseEndpoint}`

    // Ensure /v1 suffix for OpenAI-compatible API
    return normalizedUrl.endsWith('/v1')
        ? normalizedUrl
        : `${normalizedUrl}/v1`
}

/**
 * Send a chat completion request to Qwen API
 */
export async function sendQwenChatRequest(
    request: QwenChatRequest
): Promise<QwenChatResponse> {
    const token = getStoredQwenToken()

    if (!isQwenTokenValid(token)) {
        throw new Error('Qwen OAuth token is invalid or expired. Please re-authenticate.')
    }

    const endpoint = getQwenEndpoint(token)
    const url = `${endpoint}/chat/completions`

    console.log(`[QwenChat] Sending request to: ${url}`)

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token!.access_token}`,
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            model: request.model || 'qwen-coder-plus-latest',
            messages: request.messages,
            stream: false,
            temperature: request.temperature,
            max_tokens: request.max_tokens
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error(`[QwenChat] Request failed: ${response.status}`, errorText)

        // Check for auth errors that require re-authentication
        if (response.status === 401 || response.status === 403) {
            throw new Error('Qwen OAuth token expired. Please re-authenticate using /auth.')
        }

        throw new Error(`Qwen chat request failed: ${response.status} - ${errorText}`)
    }

    return await response.json()
}

/**
 * Send a streaming chat completion request to Qwen API
 */
export async function* sendQwenChatStreamRequest(
    request: QwenChatRequest
): AsyncGenerator<QwenStreamChunk> {
    const token = getStoredQwenToken()

    if (!isQwenTokenValid(token)) {
        throw new Error('Qwen OAuth token is invalid or expired. Please re-authenticate.')
    }

    const endpoint = getQwenEndpoint(token)
    const url = `${endpoint}/chat/completions`

    console.log(`[QwenChat] Sending streaming request to: ${url}`)

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token!.access_token}`,
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
            model: request.model || 'qwen-coder-plus-latest',
            messages: request.messages,
            stream: true,
            temperature: request.temperature,
            max_tokens: request.max_tokens
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error(`[QwenChat] Stream request failed: ${response.status}`, errorText)
        throw new Error(`Qwen chat request failed: ${response.status} - ${errorText}`)
    }

    if (!response.body) {
        throw new Error('Response body is missing')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            // Keep the last incomplete line in buffer
            buffer = lines.pop() || ''

            for (const line of lines) {
                const trimmed = line.trim()

                if (!trimmed || trimmed === 'data: [DONE]') {
                    continue
                }

                if (trimmed.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(trimmed.slice(6))
                        yield data as QwenStreamChunk
                    } catch (e) {
                        console.warn('[QwenChat] Failed to parse SSE chunk:', trimmed)
                    }
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}

/**
 * Get available Qwen models
 */
export async function getQwenModels(): Promise<{ id: string; name: string }[]> {
    const token = getStoredQwenToken()

    if (!isQwenTokenValid(token)) {
        return []
    }

    const endpoint = getQwenEndpoint(token)
    const url = `${endpoint}/models`

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token!.access_token}`,
                'Accept': 'application/json'
            }
        })

        if (!response.ok) {
            console.warn(`[QwenChat] Failed to fetch models: ${response.status}`)
            return getDefaultQwenModels()
        }

        const data = await response.json()
        return (data.data || []).map((model: any) => ({
            id: model.id,
            name: model.id
        }))
    } catch (error) {
        console.warn('[QwenChat] Error fetching models:', error)
        return getDefaultQwenModels()
    }
}

/**
 * Get default Qwen models when API call fails
 */
function getDefaultQwenModels(): { id: string; name: string }[] {
    return [
        { id: 'qwen-coder-plus-latest', name: 'Qwen Coder Plus' },
        { id: 'qwen-turbo-latest', name: 'Qwen Turbo' },
        { id: 'qwen-plus-latest', name: 'Qwen Plus' },
        { id: 'qwen-max-latest', name: 'Qwen Max' }
    ]
}
