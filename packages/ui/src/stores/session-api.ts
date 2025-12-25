import type { Session, Provider, Model } from "../types/session"
import type { Message } from "../types/message"

import { instances } from "./instances"
import { preferences, setAgentModelPreference, getAgentModelPreference } from "./preferences"
import { setSessionCompactionState } from "./session-compaction"
import {
  activeSessionId,
  agents,
  clearSessionDraftPrompt,
  getChildSessions,
  isBlankSession,
  messagesLoaded,
  pruneDraftPrompts,
  providers,
  setActiveSessionId,
  setAgents,
  setMessagesLoaded,
  setProviders,
  setSessionInfoByInstance,
  setSessions,
  sessions,
  loading,
  setLoading,
  cleanupBlankSessions,
} from "./session-state"
import { getInstanceConfig, ensureInstanceConfigLoaded } from "./instance-config"
import { DEFAULT_MODEL_OUTPUT_LIMIT, getDefaultModel, isModelValid } from "./session-models"
import { normalizeMessagePart } from "./message-v2/normalizers"
import { updateSessionInfo } from "./message-v2/session-info"
import { seedSessionMessagesV2 } from "./message-v2/bridge"
import { messageStoreBus } from "./message-v2/bus"
import { clearCacheForSession } from "../lib/global-cache"
import { getLogger } from "../lib/logger"
import { showToastNotification } from "../lib/notifications"
import { getUserScopedKey } from "../lib/user-storage"

const log = getLogger("api")

type ProviderMap = Map<string, Provider>

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as T
  } catch (error) {
    log.warn("Failed to fetch provider data", { url, error })
    return null
  }
}

function mergeProviders(base: Provider[], extras: Provider[]): Provider[] {
  if (extras.length === 0) return base
  const map: ProviderMap = new Map(base.map((provider) => [provider.id, { ...provider }]))

  for (const extra of extras) {
    const existing = map.get(extra.id)
    if (!existing) {
      map.set(extra.id, extra)
      continue
    }

    const modelMap = new Map<string, Model>(existing.models.map((model) => [model.id, model]))
    for (const model of extra.models) {
      if (!modelMap.has(model.id)) {
        modelMap.set(model.id, model)
      }
    }
    existing.models = Array.from(modelMap.values())
  }

  return Array.from(map.values())
}

const OLLAMA_TOAST_COOLDOWN_MS = 30000
let lastOllamaToastAt = 0
let lastOllamaToastKey = ""

function showOllamaToastOnce(key: string, payload: Parameters<typeof showToastNotification>[0]) {
  const now = Date.now()
  if (lastOllamaToastKey === key && now - lastOllamaToastAt < OLLAMA_TOAST_COOLDOWN_MS) {
    return
  }
  lastOllamaToastKey = key
  lastOllamaToastAt = now
  showToastNotification(payload)
}

async function fetchOllamaCloudProvider(): Promise<Provider | null> {
  try {
    const config = await fetchJson<{ config?: { enabled?: boolean } }>("/api/ollama/config")
    if (config && config.config?.enabled === false) {
      return null
    }

    const response = await fetch("/api/ollama/models")
    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      showOllamaToastOnce(`ollama-unavailable-${response.status}`, {
        title: "Ollama Cloud unavailable",
        message: errorText
          ? `Unable to load Ollama Cloud models (${response.status}). ${errorText}`
          : "Unable to load Ollama Cloud models. Check that the integration is enabled and the API key is valid.",
        variant: "warning",
        duration: 8000,
      })
      return null
    }
    const data = (await response.json()) as { models?: Array<{ name?: string } | string> }
    const models = Array.isArray(data?.models) ? data.models : []
    const modelNames = models
      .map((model) => (typeof model === "string" ? model : model?.name))
      .filter((name): name is string => Boolean(name))
    if (modelNames.length === 0) {
      showOllamaToastOnce("ollama-empty", {
        title: "Ollama Cloud models unavailable",
        message: "Ollama Cloud returned no models. Check your API key and endpoint.",
        variant: "warning",
        duration: 8000,
      })
      return null
    }

    return {
      id: "ollama-cloud",
      name: "Ollama Cloud",
      models: modelNames.map((name) => ({
        id: name,
        name,
        providerId: "ollama-cloud",
      })),
    }
  } catch (error) {
    log.warn("Failed to fetch Ollama Cloud models", { error })
    showOllamaToastOnce("ollama-fetch-error", {
      title: "Ollama Cloud unavailable",
      message: "Unable to load Ollama Cloud models. Check that the integration is enabled and the API key is valid.",
      variant: "warning",
      duration: 8000,
    })
    return null
  }
}

function getStoredQwenToken():
  | { access_token: string; expires_in: number; created_at: number }
  | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(getUserScopedKey("qwen_oauth_token"))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isQwenTokenValid(token: { expires_in: number; created_at: number } | null): boolean {
  if (!token) return false
  const createdAt = token.created_at > 1e12 ? Math.floor(token.created_at / 1000) : token.created_at
  const expiresAt = (createdAt + token.expires_in) * 1000 - 300000
  return Date.now() < expiresAt
}

async function fetchQwenOAuthProvider(): Promise<Provider | null> {
  const token = getStoredQwenToken()
  if (!isQwenTokenValid(token)) return null

  // Use actual Qwen model IDs that work with the DashScope API
  const qwenModels: Model[] = [
    {
      id: "qwen-coder-plus-latest",
      name: "Qwen Coder Plus (OAuth)",
      providerId: "qwen-oauth",
      limit: { context: 131072, output: 16384 },
    },
    {
      id: "qwen-turbo-latest",
      name: "Qwen Turbo (OAuth)",
      providerId: "qwen-oauth",
      limit: { context: 131072, output: 8192 },
    },
    {
      id: "qwen-plus-latest",
      name: "Qwen Plus (OAuth)",
      providerId: "qwen-oauth",
      limit: { context: 131072, output: 8192 },
    },
    {
      id: "qwen-max-latest",
      name: "Qwen Max (OAuth)",
      providerId: "qwen-oauth",
      limit: { context: 32768, output: 8192 },
    },
  ]

  return {
    id: "qwen-oauth",
    name: "Qwen OAuth",
    models: qwenModels,
    defaultModelId: "qwen-coder-plus-latest",
  }
}

async function fetchOpenCodeZenProvider(): Promise<Provider | null> {
  const data = await fetchJson<{ models?: Array<{ id: string; name: string; limit?: Model["limit"]; cost?: Model["cost"] }> }>(
    "/api/opencode-zen/models",
  )
  const models = Array.isArray(data?.models) ? data?.models ?? [] : []
  if (models.length === 0) return null

  return {
    id: "opencode-zen",
    name: "OpenCode Zen",
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      providerId: "opencode-zen",
      limit: model.limit,
      cost: model.cost,
    })),
  }
}

async function fetchZAIProvider(): Promise<Provider | null> {
  try {
    const config = await fetchJson<{ config?: { enabled?: boolean } }>("/api/zai/config")
    if (!config?.config?.enabled) return null

    const data = await fetchJson<{ models?: Array<{ name: string; provider: string }> }>("/api/zai/models")
    const models = Array.isArray(data?.models) ? data.models : []
    if (models.length === 0) return null

    return {
      id: "zai",
      name: "Z.AI Coding Plan",
      models: models.map((model) => ({
        id: model.name,
        name: model.name.toUpperCase(),
        providerId: "zai",
        limit: { context: 131072, output: 8192 },
      })),
      defaultModelId: "glm-4.7",
    }
  } catch (error) {
    log.warn("Failed to fetch Z.AI models", { error })
    return null
  }
}

async function fetchExtraProviders(): Promise<Provider[]> {
  const [ollama, zen, qwen, zai] = await Promise.all([
    fetchOllamaCloudProvider(),
    fetchOpenCodeZenProvider(),
    fetchQwenOAuthProvider(),
    fetchZAIProvider(),
  ])
  return [ollama, zen, qwen, zai].filter((provider): provider is Provider => Boolean(provider))
}

function removeDuplicateProviders(base: Provider[], extras: Provider[]): Provider[] {
  const extraModelIds = new Set(extras.flatMap((provider) => provider.models.map((model) => model.id)))
  if (!extras.some((provider) => provider.id === "opencode-zen")) {
    return base
  }

  return base.filter((provider) => {
    if (provider.id === "opencode-zen") return false
    if (provider.id === "opencode" && provider.models.every((model) => extraModelIds.has(model.id))) {
      return false
    }
    return true
  })
}

interface SessionForkResponse {
  id: string
  title?: string
  parentID?: string | null
  agent?: string
  model?: {
    providerID?: string
    modelID?: string
  }
  time?: {
    created?: number
    updated?: number
  }
  revert?: {
    messageID?: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

async function fetchSessions(instanceId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  setLoading((prev) => {
    const next = { ...prev }
    next.fetchingSessions.set(instanceId, true)
    return next
  })

  try {
    log.info("session.list", { instanceId })
    const response = await instance.client.session.list()

    const sessionMap = new Map<string, Session>()

    if (!response.data || !Array.isArray(response.data)) {
      return
    }

    const existingSessions = sessions().get(instanceId)

    // Load session tasks from storage
    await ensureInstanceConfigLoaded(instanceId)
    const instanceData = getInstanceConfig(instanceId)
    const sessionTasks = instanceData.sessionTasks || {}
    const sessionSkills = instanceData.sessionSkills || {}

    for (const apiSession of response.data) {
      const existingSession = existingSessions?.get(apiSession.id)

      const existingModel = existingSession?.model ?? { providerId: "", modelId: "" }
      const hasUserSelectedModel = existingModel.providerId && existingModel.modelId
      const apiModel = (apiSession as any).model?.providerID && (apiSession as any).model?.modelID
        ? { providerId: (apiSession as any).model.providerID, modelId: (apiSession as any).model.modelID }
        : { providerId: "", modelId: "" }

      sessionMap.set(apiSession.id, {
        id: apiSession.id,
        instanceId,
        title: apiSession.title || "Untitled",
        parentId: apiSession.parentID || null,
        agent: existingSession?.agent ?? (apiSession as any).agent ?? "",
        model: hasUserSelectedModel ? existingModel : apiModel,
        version: apiSession.version,
        time: {
          ...apiSession.time,
        },
        revert: apiSession.revert
          ? {
            messageID: apiSession.revert.messageID,
            partID: apiSession.revert.partID,
            snapshot: apiSession.revert.snapshot,
            diff: apiSession.revert.diff,
          }
          : undefined,
        tasks: sessionTasks[apiSession.id] || [],
        skills: sessionSkills[apiSession.id] || [],
      })
    }

    const validSessionIds = new Set(sessionMap.keys())

    setSessions((prev) => {
      const next = new Map(prev)
      next.set(instanceId, sessionMap)
      return next
    })

    setMessagesLoaded((prev) => {
      const next = new Map(prev)
      const loadedSet = next.get(instanceId)
      if (loadedSet) {
        const filtered = new Set<string>()
        for (const id of loadedSet) {
          if (validSessionIds.has(id)) {
            filtered.add(id)
          }
        }
        next.set(instanceId, filtered)
      }
      return next
    })

    for (const session of sessionMap.values()) {
      const flag = (session.time as (Session["time"] & { compacting?: number | boolean }) | undefined)?.compacting
      const active = typeof flag === "number" ? flag > 0 : Boolean(flag)
      setSessionCompactionState(instanceId, session.id, active)
    }

    pruneDraftPrompts(instanceId, new Set(sessionMap.keys()))
  } catch (error) {
    log.error("Failed to fetch sessions:", error)
    throw error
  } finally {
    setLoading((prev) => {
      const next = { ...prev }
      next.fetchingSessions.set(instanceId, false)
      return next
    })
  }
}

async function createSession(
  instanceId: string,
  agent?: string,
  options?: { skipAutoCleanup?: boolean },
): Promise<Session> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const instanceAgents = agents().get(instanceId) || []
  const nonSubagents = instanceAgents.filter((a) => a.mode !== "subagent")
  const selectedAgent = agent || (nonSubagents.length > 0 ? nonSubagents[0].name : "")

  const agentModelPreference = await getAgentModelPreference(instanceId, selectedAgent)
  const defaultModel = await getDefaultModel(instanceId, selectedAgent)
  const sessionModel = agentModelPreference || defaultModel

  if (selectedAgent && isModelValid(instanceId, sessionModel) && !agentModelPreference) {
    await setAgentModelPreference(instanceId, selectedAgent, sessionModel)
  }

  setLoading((prev) => {
    const next = { ...prev }
    next.creatingSession.set(instanceId, true)
    return next
  })

  try {
    log.info(`[HTTP] POST /session.create for instance ${instanceId}`)
    const response = await instance.client.session.create()

    if (!response.data) {
      throw new Error("Failed to create session: No data returned")
    }

    const session: Session = {
      id: response.data.id,
      instanceId,
      title: response.data.title || "New Session",
      parentId: null,
      agent: selectedAgent,
      model: sessionModel,
      skills: [],
      version: response.data.version,
      time: {
        ...response.data.time,
      },
      revert: response.data.revert
        ? {
          messageID: response.data.revert.messageID,
          partID: response.data.revert.partID,
          snapshot: response.data.revert.snapshot,
          diff: response.data.revert.diff,
        }
        : undefined,
    }

    setSessions((prev) => {
      const next = new Map(prev)
      const instanceSessions = next.get(instanceId) || new Map()
      instanceSessions.set(session.id, session)
      next.set(instanceId, instanceSessions)
      return next
    })

    const instanceProviders = providers().get(instanceId) || []
    const initialProvider = instanceProviders.find((p) => p.id === session.model.providerId)
    const initialModel = initialProvider?.models.find((m) => m.id === session.model.modelId)
    const initialContextWindow = initialModel?.limit?.context ?? 0
    const initialSubscriptionModel = initialModel?.cost?.input === 0 && initialModel?.cost?.output === 0
    const initialOutputLimit =
      initialModel?.limit?.output && initialModel.limit.output > 0
        ? initialModel.limit.output
        : DEFAULT_MODEL_OUTPUT_LIMIT
    const initialContextAvailable = initialContextWindow > 0 ? initialContextWindow : null

    setSessionInfoByInstance((prev) => {
      const next = new Map(prev)
      const instanceInfo = new Map(prev.get(instanceId))
      instanceInfo.set(session.id, {
        cost: 0,
        contextWindow: initialContextWindow,
        isSubscriptionModel: Boolean(initialSubscriptionModel),
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        actualUsageTokens: 0,
        modelOutputLimit: initialOutputLimit,
        contextAvailableTokens: initialContextAvailable,
      })
      next.set(instanceId, instanceInfo)
      return next
    })

    if (preferences().autoCleanupBlankSessions && !options?.skipAutoCleanup) {
      await cleanupBlankSessions(instanceId, session.id)
    }

    return session
  } catch (error) {
    log.error("Failed to create session:", error)
    throw error
  } finally {
    setLoading((prev) => {
      const next = { ...prev }
      next.creatingSession.set(instanceId, false)
      return next
    })
  }
}

async function forkSession(
  instanceId: string,
  sourceSessionId: string,
  options?: { messageId?: string },
): Promise<Session> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const request: {
    path: { id: string }
    body?: { messageID: string }
  } = {
    path: { id: sourceSessionId },
  }

  if (options?.messageId) {
    request.body = { messageID: options.messageId }
  }

  log.info(`[HTTP] POST /session.fork for instance ${instanceId}`, request)
  const response = await instance.client.session.fork(request)

  if (!response.data) {
    throw new Error("Failed to fork session: No data returned")
  }

  const sourceSession = sessions().get(instanceId)?.get(sourceSessionId)
  const sourceModel = sourceSession?.model ?? { providerId: "", modelId: "" }
  const sourceSkills = sourceSession?.skills ?? []

  const info = response.data as SessionForkResponse
  const forkedSession = {
    id: info.id,
    instanceId,
    title: info.title || "Forked Session",
    parentId: info.parentID || sourceSessionId,  // Fallback to source session to ensure parent-child relationship
    agent: info.agent || sourceSession?.agent || "",
    model: sourceModel.providerId && sourceModel.modelId
      ? { providerId: sourceModel.providerId, modelId: sourceModel.modelId }
      : {
        providerId: info.model?.providerID || "",
        modelId: info.model?.modelID || "",
      },
    skills: sourceSkills,
    version: "0",
    time: info.time ? { ...info.time } : { created: Date.now(), updated: Date.now() },
    revert: info.revert
      ? {
        messageID: info.revert.messageID,
        partID: info.revert.partID,
        snapshot: info.revert.snapshot,
        diff: info.revert.diff,
      }
      : undefined,
  } as unknown as Session

  setSessions((prev) => {
    const next = new Map(prev)
    const instanceSessions = next.get(instanceId) || new Map()
    instanceSessions.set(forkedSession.id, forkedSession)
    next.set(instanceId, instanceSessions)
    return next
  })

  const instanceProviders = providers().get(instanceId) || []
  const forkProvider = instanceProviders.find((p) => p.id === forkedSession.model.providerId)
  const forkModel = forkProvider?.models.find((m) => m.id === forkedSession.model.modelId)
  const forkContextWindow = forkModel?.limit?.context ?? 0
  const forkSubscriptionModel = forkModel?.cost?.input === 0 && forkModel?.cost?.output === 0
  const forkOutputLimit =
    forkModel?.limit?.output && forkModel.limit.output > 0 ? forkModel.limit.output : DEFAULT_MODEL_OUTPUT_LIMIT
  const forkContextAvailable = forkContextWindow > 0 ? forkContextWindow : null

  setSessionInfoByInstance((prev) => {
    const next = new Map(prev)
    const instanceInfo = new Map(prev.get(instanceId))
    instanceInfo.set(forkedSession.id, {
      cost: 0,
      contextWindow: forkContextWindow,
      isSubscriptionModel: Boolean(forkSubscriptionModel),
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      actualUsageTokens: 0,
      modelOutputLimit: forkOutputLimit,
      contextAvailableTokens: forkContextAvailable,
    })
    next.set(instanceId, instanceInfo)
    return next
  })

  return forkedSession
}

async function deleteSession(instanceId: string, sessionId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  setLoading((prev) => {
    const next = { ...prev }
    const deleting = next.deletingSession.get(instanceId) || new Set()
    deleting.add(sessionId)
    next.deletingSession.set(instanceId, deleting)
    return next
  })

  try {
    log.info(`[HTTP] DELETE /session.delete for instance ${instanceId}`, { sessionId })
    await instance.client.session.delete({ path: { id: sessionId } })

    setSessions((prev) => {
      const next = new Map(prev)
      const instanceSessions = next.get(instanceId)
      if (instanceSessions) {
        instanceSessions.delete(sessionId)
      }
      return next
    })

    setSessionCompactionState(instanceId, sessionId, false)
    clearSessionDraftPrompt(instanceId, sessionId)

    // Drop normalized message state and caches for this session
    messageStoreBus.getOrCreate(instanceId).clearSession(sessionId)
    clearCacheForSession(instanceId, sessionId)

    setSessionInfoByInstance((prev) => {
      const next = new Map(prev)
      const instanceInfo = next.get(instanceId)
      if (instanceInfo) {
        const updatedInstanceInfo = new Map(instanceInfo)
        updatedInstanceInfo.delete(sessionId)
        if (updatedInstanceInfo.size === 0) {
          next.delete(instanceId)
        } else {
          next.set(instanceId, updatedInstanceInfo)
        }
      }
      return next
    })

    if (activeSessionId().get(instanceId) === sessionId) {
      setActiveSessionId((prev) => {
        const next = new Map(prev)
        next.delete(instanceId)
        return next
      })
    }
  } catch (error) {
    log.error("Failed to delete session:", error)
    throw error
  } finally {
    setLoading((prev) => {
      const next = { ...prev }
      const deleting = next.deletingSession.get(instanceId)
      if (deleting) {
        deleting.delete(sessionId)
      }
      return next
    })
  }
}

async function fetchAgents(instanceId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  try {
    await ensureInstanceConfigLoaded(instanceId)
    log.info(`[HTTP] GET /app.agents for instance ${instanceId}`)
    const response = await instance.client.app.agents()
    const agentList = (response.data ?? []).map((agent) => ({
      name: agent.name,
      description: agent.description || "",
      mode: agent.mode,
      model: agent.model?.modelID
        ? {
          providerId: agent.model.providerID || "",
          modelId: agent.model.modelID,
        }
        : undefined,
    }))

    const customAgents = getInstanceConfig(instanceId)?.customAgents ?? []
    const customList = customAgents.map((agent) => ({
      name: agent.name,
      description: agent.description || "",
      mode: "custom",
    }))

    setAgents((prev) => {
      const next = new Map(prev)
      next.set(instanceId, [...agentList, ...customList])
      return next
    })
  } catch (error) {
    log.error("Failed to fetch agents:", error)
  }
}

async function fetchProviders(instanceId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  try {
    log.info(`[HTTP] GET /config.providers for instance ${instanceId}`)
    const response = await instance.client.config.providers()
    if (!response.data) return

    const providerList = response.data.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      defaultModelId: response.data?.default?.[provider.id],
      models: Object.entries(provider.models).map(([id, model]) => ({
        id,
        name: model.name,
        providerId: provider.id,
        limit: model.limit,
        cost: model.cost,
      })),
    }))

    // Filter out Z.AI providers from SDK to use our custom routing with full message history
    const filteredBaseProviders = providerList.filter((provider) =>
      !provider.id.toLowerCase().includes("zai") &&
      !provider.id.toLowerCase().includes("z.ai") &&
      !provider.id.toLowerCase().includes("glm")
    )

    const extraProviders = await fetchExtraProviders()
    const baseProviders = removeDuplicateProviders(filteredBaseProviders, extraProviders)
    const mergedProviders = mergeProviders(baseProviders, extraProviders)

    setProviders((prev) => {
      const next = new Map(prev)
      next.set(instanceId, mergedProviders)
      return next
    })
  } catch (error) {
    log.error("Failed to fetch providers:", error)
  }
}

async function loadMessages(instanceId: string, sessionId: string, force = false): Promise<void> {
  if (force) {
    setMessagesLoaded((prev) => {
      const next = new Map(prev)
      const loadedSet = next.get(instanceId)
      if (loadedSet) {
        loadedSet.delete(sessionId)
      }
      return next
    })
  }

  const alreadyLoaded = messagesLoaded().get(instanceId)?.has(sessionId)
  if (alreadyLoaded && !force) {
    return
  }

  const isLoading = loading().loadingMessages.get(instanceId)?.has(sessionId)
  if (isLoading) {
    return
  }

  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  setLoading((prev) => {
    const next = { ...prev }
    const loadingSet = next.loadingMessages.get(instanceId) || new Set()
    loadingSet.add(sessionId)
    next.loadingMessages.set(instanceId, loadingSet)
    return next
  })

  try {
    log.info(`[HTTP] GET /session.${"messages"} for instance ${instanceId}`, { sessionId })
    const response = await instance.client.session["messages"]({ path: { id: sessionId } })

    if (!response.data || !Array.isArray(response.data)) {
      return
    }

    const messagesInfo = new Map<string, any>()
    const messages: Message[] = response.data.map((apiMessage: any) => {
      const info = apiMessage.info || apiMessage
      const role = info.role || "assistant"
      const messageId = info.id || String(Date.now())

      messagesInfo.set(messageId, info)

      const parts: any[] = (apiMessage.parts || []).map((part: any) => normalizeMessagePart(part))

      const message: Message = {
        id: messageId,
        sessionId,
        type: role === "user" ? "user" : "assistant",
        parts,
        timestamp: info.time?.created || Date.now(),
        status: "complete" as const,
        version: 0,
      }

      return message
    })

    let agentName = ""
    let providerID = ""
    let modelID = ""

    for (let i = response.data.length - 1; i >= 0; i--) {
      const apiMessage = response.data[i]
      const info = apiMessage.info || apiMessage

      if (info.role === "assistant") {
        agentName = (info as any).mode || (info as any).agent || ""
        providerID = (info as any).providerID || ""
        modelID = (info as any).modelID || ""
        if (agentName && providerID && modelID) break
      }
    }

    if (!agentName && !providerID && !modelID) {
      const defaultModel = await getDefaultModel(instanceId, session.agent)
      agentName = session.agent
      providerID = defaultModel.providerId
      modelID = defaultModel.modelId
    }

    setSessions((prev) => {
      const next = new Map(prev)
      const nextInstanceSessions = next.get(instanceId)
      if (nextInstanceSessions) {
        const existingSession = nextInstanceSessions.get(sessionId)
        if (existingSession) {
          const currentModel = existingSession.model
          const hasUserSelectedModel = currentModel.providerId && currentModel.modelId

          const updatedSession = {
            ...existingSession,
            agent: agentName || existingSession.agent,
            model: hasUserSelectedModel ? currentModel : (providerID && modelID ? { providerId: providerID, modelId: modelID } : currentModel),
          }
          const updatedInstanceSessions = new Map(nextInstanceSessions)
          updatedInstanceSessions.set(sessionId, updatedSession)
          next.set(instanceId, updatedInstanceSessions)
        }
      }
      return next
    })

    setMessagesLoaded((prev) => {
      const next = new Map(prev)
      const loadedSet = next.get(instanceId) || new Set()
      loadedSet.add(sessionId)
      next.set(instanceId, loadedSet)
      return next
    })

    const sessionForV2 = sessions().get(instanceId)?.get(sessionId) ?? {
      id: sessionId,
      instanceId,
      parentId: session?.parentId ?? null,
      agent: "",
      model: { providerId: "", modelId: "" },
      version: "0",
      time: { created: Date.now(), updated: Date.now() },
      revert: session?.revert,
    }
    seedSessionMessagesV2(instanceId, sessionForV2, messages, messagesInfo)

  } catch (error) {
    log.error("Failed to load messages:", error)
    throw error
  } finally {
    setLoading((prev) => {
      const next = { ...prev }
      const loadingSet = next.loadingMessages.get(instanceId)
      if (loadingSet) {
        loadingSet.delete(sessionId)
      }
      return next
    })
  }

  updateSessionInfo(instanceId, sessionId)
}

export {
  createSession,
  deleteSession,
  fetchAgents,
  fetchProviders,

  fetchSessions,
  forkSession,
  loadMessages,
}
