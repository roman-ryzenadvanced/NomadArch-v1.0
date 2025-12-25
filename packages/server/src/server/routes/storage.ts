import { FastifyInstance } from "fastify"
import { z } from "zod"
import { InstanceStore } from "../../storage/instance-store"
import { EventBus } from "../../events/bus"
import { ModelPreferenceSchema } from "../../config/schema"
import type { InstanceData, Task, SessionTasks } from "../../api-types"
import { WorkspaceManager } from "../../workspaces/manager"

interface RouteDeps {
  instanceStore: InstanceStore
  eventBus: EventBus
  workspaceManager: WorkspaceManager
}

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["completed", "interrupted", "in-progress", "pending"]),
  timestamp: z.number(),
  messageIds: z.array(z.string()).optional(),
})

const InstanceDataSchema = z.object({
  messageHistory: z.array(z.string()).default([]),
  agentModelSelections: z.record(z.string(), ModelPreferenceSchema).default({}),
  sessionTasks: z.record(z.string(), z.array(TaskSchema)).optional(),
  sessionSkills: z
    .record(
      z.string(),
      z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })),
    )
    .optional(),
  customAgents: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        prompt: z.string(),
      }),
    )
    .optional(),
})

const EMPTY_INSTANCE_DATA: InstanceData = {
  messageHistory: [],
  agentModelSelections: {},
  sessionTasks: {},
  sessionSkills: {},
  customAgents: [],
}

export function registerStorageRoutes(app: FastifyInstance, deps: RouteDeps) {
  const resolveStorageKey = (instanceId: string): string => {
    const workspace = deps.workspaceManager.get(instanceId)
    return workspace?.path ?? instanceId
  }

  app.get<{ Params: { id: string } }>("/api/storage/instances/:id", async (request, reply) => {
    try {
      const storageId = resolveStorageKey(request.params.id)
      const data = await deps.instanceStore.read(storageId)
      return data
    } catch (error) {
      reply.code(500)
      return { error: error instanceof Error ? error.message : "Failed to read instance data" }
    }
  })

  app.put<{ Params: { id: string } }>("/api/storage/instances/:id", async (request, reply) => {
    try {
      const body = InstanceDataSchema.parse(request.body ?? {})
      const storageId = resolveStorageKey(request.params.id)
      await deps.instanceStore.write(storageId, body)
      deps.eventBus.publish({ type: "instance.dataChanged", instanceId: request.params.id, data: body })
      reply.code(204)
    } catch (error) {
      reply.code(400)
      return { error: error instanceof Error ? error.message : "Failed to save instance data" }
    }
  })

  app.delete<{ Params: { id: string } }>("/api/storage/instances/:id", async (request, reply) => {
    try {
      const storageId = resolveStorageKey(request.params.id)
      await deps.instanceStore.delete(storageId)
      deps.eventBus.publish({ type: "instance.dataChanged", instanceId: request.params.id, data: EMPTY_INSTANCE_DATA })
      reply.code(204)
    } catch (error) {
      reply.code(500)
      return { error: error instanceof Error ? error.message : "Failed to delete instance data" }
    }
  })
}
