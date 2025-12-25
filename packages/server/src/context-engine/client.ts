/**
 * Context Engine HTTP Client
 * Communicates with the Context-Engine RAG service for code retrieval and memory management.
 */

import { Logger } from "../logger"

export interface ContextEngineConfig {
    /** Base URL of the Context-Engine API (default: http://localhost:8000) */
    baseUrl: string
    /** Request timeout in milliseconds (default: 30000) */
    timeout: number
}

export interface IndexRequest {
    path: string
    recursive?: boolean
}

export interface IndexResponse {
    status: "started" | "completed" | "error"
    indexed_files?: number
    message?: string
}

export interface QueryRequest {
    query: string
    context_window?: number
    top_k?: number
}

export interface QueryResponse {
    results: Array<{
        content: string
        file_path: string
        score: number
        metadata?: Record<string, unknown>
    }>
    total_results: number
}

export interface MemoryRequest {
    text: string
    metadata?: Record<string, unknown>
}

export interface MemoryResponse {
    id: string
    status: "added" | "error"
}

export interface HealthResponse {
    status: "healthy" | "unhealthy"
    version?: string
    indexed_files?: number
}

const DEFAULT_CONFIG: ContextEngineConfig = {
    baseUrl: "http://localhost:8000",
    timeout: 30000,
}

export class ContextEngineClient {
    private config: ContextEngineConfig
    private logger: Logger

    constructor(config: Partial<ContextEngineConfig> = {}, logger: Logger) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.logger = logger
    }

    /**
     * Check if the Context-Engine is healthy and responding
     */
    async health(): Promise<HealthResponse> {
        try {
            const response = await this.request<HealthResponse>("/health", {
                method: "GET",
            })
            return response
        } catch (error) {
            this.logger.debug({ error }, "Context-Engine health check failed")
            return { status: "unhealthy" }
        }
    }

    /**
     * Trigger indexing for a project path
     */
    async index(path: string, recursive = true): Promise<IndexResponse> {
        this.logger.info({ path, recursive }, "Triggering Context-Engine indexing")

        try {
            const response = await this.request<IndexResponse>("/index", {
                method: "POST",
                body: JSON.stringify({ path, recursive } as IndexRequest),
            })
            this.logger.info({ path, response }, "Context-Engine indexing response")
            return response
        } catch (error) {
            this.logger.error({ path, error }, "Context-Engine indexing failed")
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Unknown error",
            }
        }
    }

    /**
     * Query the Context-Engine for relevant code snippets
     */
    async query(prompt: string, contextWindow = 4096, topK = 5): Promise<QueryResponse> {
        this.logger.debug({ prompt: prompt.slice(0, 100), contextWindow, topK }, "Querying Context-Engine")

        try {
            const response = await this.request<QueryResponse>("/query", {
                method: "POST",
                body: JSON.stringify({
                    query: prompt,
                    context_window: contextWindow,
                    top_k: topK,
                } as QueryRequest),
            })
            this.logger.debug({ resultCount: response.results.length }, "Context-Engine query completed")
            return response
        } catch (error) {
            this.logger.warn({ error }, "Context-Engine query failed")
            return { results: [], total_results: 0 }
        }
    }

    /**
     * Add a memory/rule to the Context-Engine for session-specific context
     */
    async addMemory(text: string, metadata?: Record<string, unknown>): Promise<MemoryResponse> {
        this.logger.debug({ textLength: text.length }, "Adding memory to Context-Engine")

        try {
            const response = await this.request<MemoryResponse>("/memory", {
                method: "POST",
                body: JSON.stringify({ text, metadata } as MemoryRequest),
            })
            return response
        } catch (error) {
            this.logger.warn({ error }, "Context-Engine addMemory failed")
            return { id: "", status: "error" }
        }
    }

    /**
     * Get the current indexing status
     */
    async getStatus(): Promise<{ indexing: boolean; indexed_files: number; last_indexed?: string }> {
        try {
            const response = await this.request<{ indexing: boolean; indexed_files: number; last_indexed?: string }>("/status", {
                method: "GET",
            })
            return response
        } catch (error) {
            return { indexing: false, indexed_files: 0 }
        }
    }

    private async request<T>(endpoint: string, options: RequestInit): Promise<T> {
        const url = `${this.config.baseUrl}${endpoint}`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    ...options.headers,
                },
                signal: controller.signal,
            })

            if (!response.ok) {
                const errorText = await response.text().catch(() => "")
                throw new Error(`Context-Engine request failed: ${response.status} ${response.statusText} - ${errorText}`)
            }

            return await response.json() as T
        } finally {
            clearTimeout(timeoutId)
        }
    }
}
