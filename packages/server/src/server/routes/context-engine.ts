/**
 * Context-Engine API routes
 * Provides endpoints for querying the Context-Engine status and manually triggering operations.
 */

import type { FastifyInstance } from "fastify"
import { getContextEngineService } from "../../context-engine"

export function registerContextEngineRoutes(app: FastifyInstance) {
    // Get Context-Engine status
    app.get("/api/context-engine/status", async (request, reply) => {
        const service = getContextEngineService()

        if (!service) {
            return reply.send({
                status: "stopped",
                message: "Context-Engine service not initialized"
            })
        }

        const status = service.getStatus()
        const client = service.getClient()

        // Get more detailed status from the engine if it's running
        let details: Record<string, unknown> = {}
        if (service.isReady()) {
            try {
                const engineStatus = await client.getStatus()
                details = {
                    indexing: engineStatus.indexing,
                    indexed_files: engineStatus.indexed_files,
                    last_indexed: engineStatus.last_indexed
                }
            } catch {
                // Ignore errors, just don't include details
            }
        }

        return reply.send({
            status,
            ready: service.isReady(),
            ...details
        })
    })

    // Get Context-Engine health
    app.get("/api/context-engine/health", async (request, reply) => {
        const service = getContextEngineService()

        if (!service) {
            return reply.send({ status: "unhealthy", reason: "Service not initialized" })
        }

        const client = service.getClient()
        const health = await client.health()

        return reply.send(health)
    })

    // Manually trigger indexing for a path
    app.post("/api/context-engine/index", {
        schema: {
            body: {
                type: "object",
                required: ["path"],
                properties: {
                    path: { type: "string" }
                }
            }
        }
    }, async (request, reply) => {
        const service = getContextEngineService()

        if (!service) {
            return reply.status(503).send({
                error: "Context-Engine service not available"
            })
        }

        const { path } = request.body as { path: string }

        // Start indexing (non-blocking)
        service.indexPath(path).catch(() => {
            // Errors are logged internally
        })

        return reply.send({
            status: "started",
            message: `Indexing started for: ${path}`
        })
    })

    // Query the Context-Engine
    app.post("/api/context-engine/query", {
        schema: {
            body: {
                type: "object",
                required: ["query"],
                properties: {
                    query: { type: "string" },
                    context_window: { type: "number" }
                }
            }
        }
    }, async (request, reply) => {
        const service = getContextEngineService()

        if (!service || !service.isReady()) {
            return reply.status(503).send({
                error: "Context-Engine not ready",
                results: [],
                total_results: 0
            })
        }

        const { query, context_window } = request.body as { query: string; context_window?: number }
        const client = service.getClient()

        try {
            const response = await client.query(query, context_window ?? 4096)
            return reply.send(response)
        } catch (error) {
            return reply.status(500).send({
                error: error instanceof Error ? error.message : "Query failed",
                results: [],
                total_results: 0
            })
        }
    })
}
