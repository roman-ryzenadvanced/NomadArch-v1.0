/**
 * Context Engine Service
 * Manages the lifecycle of the Context-Engine process (Python sidecar)
 * and provides access to the Context-Engine client.
 */

import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"
import { Logger } from "../logger"
import { ContextEngineClient, ContextEngineConfig, HealthResponse } from "./client"

export type ContextEngineStatus = "stopped" | "starting" | "ready" | "indexing" | "error"

export interface ContextEngineServiceConfig {
    /** Path to the context-engine executable or Python script */
    binaryPath?: string
    /** Arguments to pass to the context-engine process */
    args?: string[]
    /** Port for the Context-Engine API (default: 8000) */
    port: number
    /** Host for the Context-Engine API (default: localhost) */
    host: string
    /** Whether to auto-start the engine when first needed (lazy start) */
    lazyStart: boolean
    /** Health check interval in milliseconds */
    healthCheckInterval: number
    /** Max retries for health check before marking as error */
    maxHealthCheckRetries: number
}

const DEFAULT_SERVICE_CONFIG: ContextEngineServiceConfig = {
    binaryPath: "context-engine",
    args: [],
    port: 8000,
    host: "localhost",
    lazyStart: true,
    healthCheckInterval: 5000,
    maxHealthCheckRetries: 3,
}

export class ContextEngineService extends EventEmitter {
    private config: ContextEngineServiceConfig
    private logger: Logger
    private process: ChildProcess | null = null
    private client: ContextEngineClient
    private status: ContextEngineStatus = "stopped"
    private healthCheckTimer: NodeJS.Timeout | null = null
    private healthCheckFailures = 0
    private indexingPaths = new Set<string>()

    constructor(config: Partial<ContextEngineServiceConfig> = {}, logger: Logger) {
        super()
        this.config = { ...DEFAULT_SERVICE_CONFIG, ...config }
        this.logger = logger

        const clientConfig: Partial<ContextEngineConfig> = {
            baseUrl: `http://${this.config.host}:${this.config.port}`,
            timeout: 30000,
        }
        this.client = new ContextEngineClient(clientConfig, logger)
    }

    /**
     * Get the current status of the Context-Engine
     */
    getStatus(): ContextEngineStatus {
        return this.status
    }

    /**
     * Check if the Context-Engine is ready to accept requests
     */
    isReady(): boolean {
        return this.status === "ready" || this.status === "indexing"
    }

    /**
     * Get the Context-Engine client for making API calls
     */
    getClient(): ContextEngineClient {
        return this.client
    }

    /**
     * Start the Context-Engine process
     */
    async start(): Promise<boolean> {
        if (this.status === "ready" || this.status === "starting") {
            this.logger.debug("Context-Engine already started or starting")
            return true
        }

        this.setStatus("starting")
        this.logger.info({ config: this.config }, "Starting Context-Engine service")

        // First, check if an external Context-Engine is already running
        const externalHealth = await this.client.health()
        if (externalHealth.status === "healthy") {
            this.logger.info("External Context-Engine detected and healthy")
            this.setStatus("ready")
            this.startHealthCheck()
            return true
        }

        // Try to spawn the process
        if (!this.config.binaryPath) {
            this.logger.warn("No binary path configured for Context-Engine")
            this.setStatus("error")
            return false
        }

        try {
            const args = [
                ...(this.config.args || []),
                "--port", String(this.config.port),
                "--host", this.config.host,
            ]

            this.logger.info({ binary: this.config.binaryPath, args }, "Spawning Context-Engine process")

            this.process = spawn(this.config.binaryPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
                detached: false,
            })

            this.process.stdout?.on("data", (data) => {
                this.logger.debug({ output: data.toString().trim() }, "Context-Engine stdout")
            })

            this.process.stderr?.on("data", (data) => {
                this.logger.debug({ output: data.toString().trim() }, "Context-Engine stderr")
            })

            this.process.on("error", (error) => {
                this.logger.error({ error }, "Context-Engine process error")
                this.setStatus("error")
            })

            this.process.on("exit", (code, signal) => {
                this.logger.info({ code, signal }, "Context-Engine process exited")
                this.process = null
                if (this.status !== "stopped") {
                    this.setStatus("error")
                }
            })

            // Wait for the process to become ready
            const ready = await this.waitForReady(30000)
            if (ready) {
                this.setStatus("ready")
                this.startHealthCheck()
                return true
            } else {
                this.logger.error("Context-Engine failed to become ready")
                this.setStatus("error")
                return false
            }
        } catch (error) {
            this.logger.error({ error }, "Failed to spawn Context-Engine process")
            this.setStatus("error")
            return false
        }
    }

    /**
     * Stop the Context-Engine process
     */
    async stop(): Promise<void> {
        this.stopHealthCheck()
        this.setStatus("stopped")

        if (this.process) {
            this.logger.info("Stopping Context-Engine process")
            this.process.kill("SIGTERM")

            // Wait for graceful shutdown
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.process) {
                        this.logger.warn("Context-Engine did not exit gracefully, killing")
                        this.process.kill("SIGKILL")
                    }
                    resolve()
                }, 5000)

                if (this.process) {
                    this.process.once("exit", () => {
                        clearTimeout(timeout)
                        resolve()
                    })
                } else {
                    clearTimeout(timeout)
                    resolve()
                }
            })

            this.process = null
        }
    }

    /**
     * Trigger indexing for a workspace path (non-blocking)
     */
    async indexPath(path: string): Promise<void> {
        if (!this.config.lazyStart && !this.isReady()) {
            this.logger.debug({ path }, "Context-Engine not ready, skipping indexing")
            return
        }

        // Lazy start if needed
        if (this.config.lazyStart && this.status === "stopped") {
            this.logger.info({ path }, "Lazy-starting Context-Engine for indexing")
            const started = await this.start()
            if (!started) {
                this.logger.warn({ path }, "Failed to start Context-Engine for indexing")
                return
            }
        }

        if (this.indexingPaths.has(path)) {
            this.logger.debug({ path }, "Path already being indexed")
            return
        }

        this.indexingPaths.add(path)
        this.setStatus("indexing")

        // Fire and forget - don't block workspace creation
        this.client.index(path).then((response) => {
            this.indexingPaths.delete(path)
            if (response.status === "error") {
                this.logger.warn({ path, response }, "Context-Engine indexing failed")
            } else {
                this.logger.info({ path, indexed_files: response.indexed_files }, "Context-Engine indexing completed")
            }
            if (this.indexingPaths.size === 0 && this.status === "indexing") {
                this.setStatus("ready")
            }
            this.emit("indexComplete", { path, response })
        }).catch((error) => {
            this.indexingPaths.delete(path)
            this.logger.error({ path, error }, "Context-Engine indexing error")
            if (this.indexingPaths.size === 0 && this.status === "indexing") {
                this.setStatus("ready")
            }
        })
    }

    /**
     * Query the Context-Engine for relevant code snippets
     */
    async query(prompt: string, contextWindow?: number): Promise<string | null> {
        if (!this.isReady()) {
            return null
        }

        try {
            const response = await this.client.query(prompt, contextWindow)
            if (response.results.length === 0) {
                return null
            }

            // Format the results as a context block
            const contextParts = response.results.map((result, index) => {
                return `// File: ${result.file_path} (relevance: ${(result.score * 100).toFixed(1)}%)\n${result.content}`
            })

            return `<context_engine_retrieval>\n${contextParts.join("\n\n")}\n</context_engine_retrieval>`
        } catch (error) {
            this.logger.warn({ error }, "Context-Engine query failed")
            return null
        }
    }

    private setStatus(status: ContextEngineStatus): void {
        if (this.status !== status) {
            this.logger.info({ oldStatus: this.status, newStatus: status }, "Context-Engine status changed")
            this.status = status
            this.emit("statusChange", status)
        }
    }

    private async waitForReady(timeoutMs: number): Promise<boolean> {
        const startTime = Date.now()
        const checkInterval = 500

        while (Date.now() - startTime < timeoutMs) {
            const health = await this.client.health()
            if (health.status === "healthy") {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval))
        }

        return false
    }

    private startHealthCheck(): void {
        if (this.healthCheckTimer) return

        this.healthCheckTimer = setInterval(async () => {
            const health = await this.client.health()
            if (health.status === "healthy") {
                this.healthCheckFailures = 0
                if (this.status === "error") {
                    this.setStatus("ready")
                }
            } else {
                this.healthCheckFailures++
                if (this.healthCheckFailures >= this.config.maxHealthCheckRetries) {
                    this.logger.warn("Context-Engine health check failed multiple times")
                    this.setStatus("error")
                }
            }
        }, this.config.healthCheckInterval)
    }

    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer)
            this.healthCheckTimer = null
        }
    }
}

// Singleton instance for global access
let globalContextEngineService: ContextEngineService | null = null

export function getContextEngineService(): ContextEngineService | null {
    return globalContextEngineService
}

export function initializeContextEngineService(
    config: Partial<ContextEngineServiceConfig>,
    logger: Logger
): ContextEngineService {
    if (globalContextEngineService) {
        return globalContextEngineService
    }
    globalContextEngineService = new ContextEngineService(config, logger)
    return globalContextEngineService
}

export async function shutdownContextEngineService(): Promise<void> {
    if (globalContextEngineService) {
        await globalContextEngineService.stop()
        globalContextEngineService = null
    }
}
