import { untrack, batch } from "solid-js"
import { addDebugLog } from "../components/debug-overlay"
import { resolvePastedPlaceholders } from "../lib/prompt-placeholders"
import { instances, activeInstanceId } from "./instances"
import { addTaskMessage } from "./task-actions"

import { addRecentModelPreference, setAgentModelPreference, getAgentModelPreference } from "./preferences"
import { sessions, withSession, providers, setActiveParentSession, setActiveSession } from "./session-state"
import { getDefaultModel, isModelValid } from "./session-models"
import { updateSessionInfo } from "./message-v2/session-info"
import { messageStoreBus } from "./message-v2/bus"
import { buildRecordDisplayData } from "./message-v2/record-display-cache"
import { getLogger } from "../lib/logger"
import {
  executeCompactionWrapper,
  getSessionCompactionState,
  setSessionCompactionState,
  setCompactionSuggestion,
  clearCompactionSuggestion,
  type CompactionResult,
} from "./session-compaction"
import { createSession, loadMessages } from "./session-api"
import { showToastNotification } from "../lib/notifications"
import { QwenOAuthManager } from "../lib/integrations/qwen-oauth"
import { getUserScopedKey } from "../lib/user-storage"
import { loadSkillDetails } from "./skills"
import { serverApi } from "../lib/api-client"

const log = getLogger("actions")

const ID_LENGTH = 26
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

const tokenWarningState = new Map<string, { timestamp: number; suppressContextError: boolean }>()
const compactionAttemptState = new Map<string, { timestamp: number; suppressContextError: boolean }>()
const TOKEN_WARNING_TTL_MS = 30_000
const COMPACTION_ATTEMPT_TTL_MS = 60_000
const COMPACTION_SUMMARY_MAX_CHARS = 4000
const STREAM_TIMEOUT_MS = 120_000
const OPENCODE_ZEN_OFFLINE_STORAGE_KEY = "opencode-zen-offline-models"
export const BUILD_PREVIEW_EVENT = "opencode:build-preview"
export const FILE_CHANGE_EVENT = "opencode:workspace-files-changed"

function markOpencodeZenModelOffline(modelId: string): void {
  if (typeof window === "undefined" || !modelId) return
  try {
    const key = getUserScopedKey(OPENCODE_ZEN_OFFLINE_STORAGE_KEY)
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? parsed : []
    if (!list.includes(modelId)) {
      list.push(modelId)
      window.localStorage.setItem(key, JSON.stringify(list))
      window.dispatchEvent(
        new CustomEvent("opencode-zen-offline-models", { detail: { modelId } }),
      )
    }
  } catch {
    // Ignore storage errors
  }
}

let lastTimestamp = 0
let localCounter = 0

function randomBase62(length: number): string {
  let result = ""
  const cryptoObj = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(length)
    cryptoObj.getRandomValues(bytes)
    for (let i = 0; i < length; i++) {
      result += BASE62_CHARS[bytes[i] % BASE62_CHARS.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      const idx = Math.floor(Math.random() * BASE62_CHARS.length)
      result += BASE62_CHARS[idx]
    }
  }
  return result
}

function createId(prefix: string): string {
  const timestamp = Date.now()
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    localCounter = 0
  }
  localCounter++

  const value = (BigInt(timestamp) << BigInt(12)) + BigInt(localCounter)
  const bytes = new Array<number>(6)
  for (let i = 0; i < 6; i++) {
    const shift = BigInt(8 * (5 - i))
    bytes[i] = Number((value >> shift) & BigInt(0xff))
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("")
  const random = randomBase62(ID_LENGTH - 12)

  return `${prefix}_${hex}${random}`
}

function getModelLimits(instanceId: string, session: any): { contextLimit: number; outputLimit: number } {
  const instanceProviders = providers().get(instanceId) || []
  const provider = instanceProviders.find((p) => p.id === session.model.providerId)
  const model = provider?.models.find((m) => m.id === session.model.modelId)

  return {
    contextLimit: model?.limit?.context || 128000,
    outputLimit: model?.limit?.output || 32000,
  }
}

function getWarningKey(instanceId: string, sessionId: string): string {
  return `${instanceId}:${sessionId}`
}

function setTokenWarningState(instanceId: string, sessionId: string, suppressContextError: boolean): void {
  tokenWarningState.set(getWarningKey(instanceId, sessionId), {
    timestamp: Date.now(),
    suppressContextError,
  })
}

export function consumeTokenWarningSuppression(instanceId: string, sessionId: string): boolean {
  const key = getWarningKey(instanceId, sessionId)
  const entry = tokenWarningState.get(key)
  if (!entry) return false
  tokenWarningState.delete(key)
  if (Date.now() - entry.timestamp > TOKEN_WARNING_TTL_MS) {
    return false
  }
  return entry.suppressContextError
}

export function consumeCompactionSuppression(instanceId: string, sessionId: string): boolean {
  const key = getWarningKey(instanceId, sessionId)
  const entry = compactionAttemptState.get(key)
  if (!entry) return false
  compactionAttemptState.delete(key)
  if (Date.now() - entry.timestamp > COMPACTION_ATTEMPT_TTL_MS) {
    return false
  }
  return entry.suppressContextError
}

function buildCompactionSeed(result: CompactionResult): string {
  const lines: string[] = []
  lines.push("Compacted session summary.")
  lines.push("")
  lines.push(`Summary: ${result.human_summary}`)

  const details = result.detailed_summary
  if (details?.what_was_done?.length) {
    lines.push("")
    lines.push("What was done:")
    details.what_was_done.slice(0, 8).forEach((entry) => lines.push(`- ${entry}`))
  }
  if (details?.files?.length) {
    lines.push("")
    lines.push("Files:")
    details.files.slice(0, 8).forEach((file) => lines.push(`- ${file.path}: ${file.notes}`))
  }
  if (details?.current_state) {
    lines.push("")
    lines.push(`Current state: ${details.current_state}`)
  }
  if (details?.next_steps?.length) {
    lines.push("")
    lines.push("Next steps:")
    details.next_steps.slice(0, 6).forEach((step) => lines.push(`- ${step}`))
  }
  if (details?.blockers?.length) {
    lines.push("")
    lines.push("Blockers:")
    details.blockers.slice(0, 6).forEach((blocker) => lines.push(`- ${blocker}`))
  }

  const output = lines.join("\n").trim()
  if (output.length <= COMPACTION_SUMMARY_MAX_CHARS) {
    return output
  }
  return `${output.slice(0, COMPACTION_SUMMARY_MAX_CHARS - 3)}...`
}

async function checkTokenBudgetBeforeSend(
  instanceId: string,
  sessionId: string,
  session: any,
): Promise<boolean> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) return true

  const usage = store.getSessionUsage(sessionId)
  const { contextLimit, outputLimit } = getModelLimits(instanceId, session)

  // Use actualUsageTokens which is the REAL context usage from the last message
  // NOT the cumulative total of all tokens ever processed
  const currentContextUsage = usage?.actualUsageTokens || 0

  // Only show warning if we're actually near the limit
  // Using 80% threshold before warning
  const warningThreshold = contextLimit * 0.8

  const existingWarning = tokenWarningState.get(getWarningKey(instanceId, sessionId))
  if (existingWarning && Date.now() - existingWarning.timestamp < TOKEN_WARNING_TTL_MS) {
    return true
  }

  if (getSessionCompactionState(instanceId, sessionId)) {
    return false
  }

  if (currentContextUsage >= warningThreshold && currentContextUsage + outputLimit >= contextLimit) {
    log.warn("Token budget approaching limit", {
      instanceId,
      sessionId,
      currentContextUsage,
      outputLimit,
      contextLimit,
      warningThreshold,
    })

    setCompactionSuggestion(
      instanceId,
      sessionId,
      `Context usage is high (${currentContextUsage.toLocaleString()} / ${contextLimit.toLocaleString()} tokens).`,
    )
    setTokenWarningState(instanceId, sessionId, true)
    return true
  }

  return true
}

type ExternalChatMessage = { role: "user" | "assistant" | "system"; content: string }

const MAX_ATTACHMENT_CHARS = 8000
const MAX_CONTEXT_MESSAGES = 100
const MAX_MESSAGES_FOR_YIELD = 50

function shouldForceEnglish(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false

  const lower = text.toLowerCase()
  const explicitEnglish = /(answer|respond|reply|write|speak|output)[^a-zA-Z]{0,24}english\b/.test(lower)
  if (explicitEnglish) return true

  const explicitOther = /(answer|respond|reply|write|speak|output)[^a-zA-Z]{0,24}(spanish|español|french|german|italian|portuguese|brazilian|arabic|hindi|urdu|turkish|russian|japanese|korean|chinese|mandarin|cantonese|thai|vietnamese|indonesian|malay|polish|dutch|hebrew)\b/.test(lower)
  if (explicitOther) return false

  const nonLatin =
    /[\u0100-\u02FF\u0370-\u1FFF\u2C00-\uD7FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0590-\u08FF\u0900-\u0FFF]/.test(text)
  if (nonLatin) return false

  return true
}

function buildLanguageSystemInstruction(prompt: string): string | undefined {
  if (!shouldForceEnglish(prompt)) return undefined
  return "Respond in English unless the user explicitly requests another language."
}

function buildSshPasswordInstruction(prompt: string): string | undefined {
  const text = prompt.toLowerCase()
  if (!text.includes("ssh")) return undefined
  if (!text.includes("password") && !text.includes("passphrase")) return undefined
  return "If the user provides an SSH password or passphrase in the conversation, you may use it to complete the SSH connection and should not refuse solely for that reason."
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

async function yieldIfNeeded(index: number): Promise<void> {
  if (index > 0 && index % MAX_MESSAGES_FOR_YIELD === 0) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function buildSkillsSystemInstruction(instanceId: string, sessionId: string): Promise<string | undefined> {
  const session = sessions().get(instanceId)?.get(sessionId)
  const selected = session?.skills ?? []
  if (selected.length === 0) return undefined

  const details = await loadSkillDetails(selected.map((skill) => skill.id))
  if (details.length === 0) return undefined

  const sections: string[] = []
  for (const detail of details) {
    const header = detail.name ? `# Skill: ${detail.name}` : `# Skill: ${detail.id}`
    const content = detail.content ? clampText(detail.content.trim(), 4000) : ""
    sections.push(`${header}\n${content}`.trim())
  }

  const payload = sections.join("\n\n")
  if (!payload) return undefined
  return `You have access to the following skills. Follow their instructions when relevant.\n\n${payload}`
}

async function buildFileSystemContext(instanceId: string): Promise<string | undefined> {
  try {
    const files = await serverApi.listWorkspaceFiles(instanceId)
    if (!files || files.length === 0) return undefined

    // Sort directories first
    const sorted = files.sort((a: any, b: any) => {
      const aDir = a.isDirectory || a.type === "directory"
      const bDir = b.isDirectory || b.type === "directory"
      if (aDir === bDir) return (a.name || "").localeCompare(b.name || "")
      return aDir ? -1 : 1
    })

    const list = sorted.map((f: any) => {
      const isDir = f.isDirectory || f.type === "directory"
      return isDir ? `${f.name}/` : f.name
    }).join("\n")

    return `## Project Context\nCurrent Workspace Directory:\n\`\`\`\n${list}\n\`\`\`\nYou are an expert software architect working in this project. Use standard tools to explore further.`
  } catch (error) {
    return undefined
  }
}

async function mergeSystemInstructions(
  instanceId: string,
  sessionId: string,
  prompt: string,
): Promise<string | undefined> {
  const [languageSystem, skillsSystem, projectContext] = await Promise.all([
    Promise.resolve(buildLanguageSystemInstruction(prompt)),
    buildSkillsSystemInstruction(instanceId, sessionId),
    buildFileSystemContext(instanceId),
  ])
  const sshInstruction = buildSshPasswordInstruction(prompt)
  const sections = [projectContext, languageSystem, skillsSystem, sshInstruction].filter(Boolean) as string[]
  if (sections.length === 0) return undefined
  return sections.join("\n\n")
}

function collectTextSegments(value: unknown, segments: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed) segments.push(trimmed)
    return
  }

  if (!value || typeof value !== "object") return

  const record = value as Record<string, unknown>
  if (typeof record.text === "string") {
    const trimmed = record.text.trim()
    if (trimmed) segments.push(trimmed)
  }
  if (typeof record.value === "string") {
    const trimmed = record.value.trim()
    if (trimmed) segments.push(trimmed)
  }
  const content = record.content
  if (Array.isArray(content)) {
    for (const item of content) {
      collectTextSegments(item, segments)
    }
  }
}

function extractPlainTextFromParts(
  parts: Array<{ type?: string; text?: unknown; filename?: string }>,
): string {
  const segments: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    if (part.type === "text" || part.type === "reasoning") {
      collectTextSegments(part.text, segments)
    } else if (part.type === "file" && typeof part.filename === "string") {
      segments.push(`[file: ${part.filename}]`)
    }
  }
  return segments.join("\n").trim()
}

async function buildExternalChatMessages(
  instanceId: string,
  sessionId: string,
  systemMessage?: string,
): Promise<ExternalChatMessage[]> {
  return untrack(async () => {
    const store = messageStoreBus.getOrCreate(instanceId)
    const messageIds = store.getSessionMessageIds(sessionId)
    const messages: ExternalChatMessage[] = []

    if (systemMessage) {
      messages.push({ role: "system", content: systemMessage })
    }

    const limitedMessageIds = messageIds.length > MAX_CONTEXT_MESSAGES
      ? messageIds.slice(-MAX_CONTEXT_MESSAGES)
      : messageIds

    for (let i = 0; i < limitedMessageIds.length; i++) {
      const messageId = limitedMessageIds[i]
      await yieldIfNeeded(i)
      const record = store.getMessage(messageId)
      if (!record) continue
      const { orderedParts } = buildRecordDisplayData(instanceId, record)
      const content = extractPlainTextFromParts(orderedParts as Array<{ type?: string; text?: unknown; filename?: string }>)
      if (!content) continue
      messages.push({
        role: record.role === "assistant" ? "assistant" : "user",
        content,
      })
    }

    return messages
  })
}

function decodeAttachmentData(data: Uint8Array): string {
  const decoder = new TextDecoder()
  return decoder.decode(data)
}

function isTextLikeMime(mime?: string): boolean {
  if (!mime) return false
  if (mime.startsWith("text/")) return true
  return ["application/json", "application/xml", "application/x-yaml"].includes(mime)
}

async function buildExternalChatMessagesWithAttachments(
  instanceId: string,
  sessionId: string,
  systemMessage: string | undefined,
  attachments: Array<{ filename?: string; source?: any; mediaType?: string }>,
): Promise<ExternalChatMessage[]> {
  const baseMessages = await buildExternalChatMessages(instanceId, sessionId, systemMessage)
  if (!attachments || attachments.length === 0) {
    return baseMessages
  }

  const attachmentMessages: ExternalChatMessage[] = []

  for (const attachment of attachments) {
    const source = attachment?.source
    if (!source || typeof source !== "object") continue

    let content: string | null = null
    if (source.type === "text" && typeof source.value === "string") {
      content = source.value
    } else if (source.type === "file") {
      if (source.data instanceof Uint8Array && isTextLikeMime(source.mime || attachment.mediaType)) {
        content = decodeAttachmentData(source.data)
      } else if (typeof source.path === "string" && source.path.length > 0) {
        try {
          const response = await serverApi.readWorkspaceFile(instanceId, source.path)
          content = typeof response.contents === "string" ? response.contents : null
        } catch {
          content = null
        }
      }
    }

    if (!content) continue
    const filename = attachment.filename || source.path || "attachment"
    const trimmed = clampText(content, MAX_ATTACHMENT_CHARS)
    attachmentMessages.push({
      role: "user",
      content: `Attachment: ${filename}\n\n${trimmed}`,
    })
  }

  return [...baseMessages, ...attachmentMessages]
}

async function readSseStream(
  response: Response,
  onData: (data: string) => void,
  idleTimeoutMs: number = 45_000,
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is missing")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let shouldStop = false
  let timedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      reader.cancel().catch(() => { })
    }, idleTimeoutMs)
  }
  resetIdleTimer()

  try {
    let chunkCount = 0
    let lastYieldTime = performance.now()
    while (!shouldStop) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === "[DONE]") {
          shouldStop = true
          break
        }
        onData(data)
        chunkCount++
      }
      // Throttle UI updates: yield control if time elapsed > 16ms to prevent frame drops
      const now = performance.now()
      if (now - lastYieldTime > 16) {
        addDebugLog(`Yielding after ${Math.round(now - lastYieldTime)}ms (chunks: ${chunkCount})`, "info")
        lastYieldTime = now
        if ('requestIdleCallback' in window) {
          await new Promise<void>(resolve => {
            requestIdleCallback(() => resolve(), { timeout: 16 })
          })
        } else {
          await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
      }
    }
    if (timedOut) {
      throw new Error("Stream timed out")
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    reader.releaseLock()
  }
}

async function streamOllamaChat(
  instanceId: string,
  sessionId: string,
  providerId: string,
  modelId: string,
  messages: ExternalChatMessage[],
  messageId: string,
  assistantMessageId: string,
  assistantPartId: string,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)

  // Get workspace path for tool execution
  const instance = instances().get(instanceId)
  const workspacePath = instance?.folder || ""

  const response = await fetch("/api/ollama/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      workspacePath,
      enableTools: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Ollama chat failed (${response.status})`)
  }

  const store = messageStoreBus.getOrCreate(instanceId)
  store.beginStreamingUpdate()
  let fullText = ""
  let lastUpdateAt = 0

  try {
    await readSseStream(response, (data) => {
      try {
        const chunk = JSON.parse(data)
        if (chunk?.error) throw new Error(chunk.error)

        // Handle tool execution results (special events from backend)
        if (chunk?.type === "tool_result") {
          const toolResult = `\n\n✅ **Tool Executed:** ${chunk.content}\n\n`
          fullText += toolResult
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })

          // Dispatch file change event to refresh sidebar
          if (typeof window !== "undefined") {
            console.log(`[EVENT] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            window.dispatchEvent(new CustomEvent(FILE_CHANGE_EVENT, { detail: { instanceId } }))
          }

          // Auto-trigger preview for HTML file writes
          const content = chunk.content || ""
          if (content.includes("Successfully wrote") &&
            (content.includes(".html") || content.includes("index.") || content.includes(".htm"))) {
            if (typeof window !== "undefined") {
              const htmlMatch = content.match(/to\s+([^\s]+\.html?)/)
              if (htmlMatch) {
                const relativePath = htmlMatch[1]
                const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
                const apiOrigin = origin.replace(":3000", ":9898")
                const previewUrl = `${apiOrigin}/api/workspaces/${instanceId}/serve/${relativePath}`

                console.log(`[EVENT] Auto-preview triggered for ${previewUrl}`);
                window.dispatchEvent(new CustomEvent(BUILD_PREVIEW_EVENT, {
                  detail: { url: previewUrl, instanceId }
                }))
              }
            }
          }

          return
        }

        const delta = chunk?.message?.content
        if (typeof delta !== "string" || delta.length === 0) return
        fullText += delta

        const now = Date.now()
        if (now - lastUpdateAt > 150) { // Limit to ~7 updates per second
          lastUpdateAt = now
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })
        }
      } catch (e) {
        if (e instanceof Error) throw e
      }
    })

    // Always apply final text update
    store.applyPartUpdate({
      messageId: assistantMessageId,
      part: { id: assistantPartId, type: "text", text: fullText } as any,
    })
  } finally {
    clearTimeout(timeoutId)
    store.endStreamingUpdate()
  }

  batch(() => {
    store.upsertMessage({
      id: assistantMessageId,
      sessionId,
      role: "assistant",
      status: "complete",
      updatedAt: Date.now(),
      isEphemeral: false,
    })
    store.setMessageInfo(assistantMessageId, {
      id: assistantMessageId,
      role: "assistant",
      providerID: providerId,
      modelID: modelId,
      time: { created: store.getMessageInfo(assistantMessageId)?.time?.created ?? Date.now(), completed: Date.now() },
    } as any)
    store.upsertMessage({
      id: messageId,
      sessionId,
      role: "user",
      status: "sent",
      updatedAt: Date.now(),
      isEphemeral: false,
    })
  })
}

async function streamQwenChat(
  instanceId: string,
  sessionId: string,
  providerId: string,
  modelId: string,
  messages: ExternalChatMessage[],
  accessToken: string,
  resourceUrl: string | undefined,
  messageId: string,
  assistantMessageId: string,
  assistantPartId: string,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)

  // Get workspace path for tool execution
  const instance = instances().get(instanceId)
  const workspacePath = instance?.folder || ""

  const response = await fetch("/api/qwen/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      resource_url: resourceUrl,
      workspacePath,
      enableTools: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Qwen chat failed (${response.status})`)
  }

  const store = messageStoreBus.getOrCreate(instanceId)
  store.beginStreamingUpdate()
  let fullText = ""
  let lastUpdateAt = 0

  try {
    await readSseStream(response, (data) => {
      try {
        const chunk = JSON.parse(data)

        // Handle tool execution results
        if (chunk?.type === "tool_result") {
          const toolResult = `\n\n✅ **Tool Executed:** ${chunk.content}\n\n`
          fullText += toolResult
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })

          // Dispatch file change event to refresh sidebar
          if (typeof window !== "undefined") {
            console.log(`[Qwen] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            console.log(`[EVENT] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            window.dispatchEvent(new CustomEvent(FILE_CHANGE_EVENT, { detail: { instanceId } }));

            // Double-tap refresh after 1s to catch FS latency
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(FILE_CHANGE_EVENT, { detail: { instanceId } }));
            }, 1000);
          }

          // Auto-trigger preview for HTML file writes
          const content = chunk.content || ""
          if (content.includes("Successfully wrote") &&
            (content.includes(".html") || content.includes("index.") || content.includes(".htm"))) {
            if (typeof window !== "undefined") {
              const htmlMatch = content.match(/to\s+([^\s]+\.html?)/)
              if (htmlMatch) {
                const relativePath = htmlMatch[1]
                const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
                const apiOrigin = origin.replace(":3000", ":9898")
                const previewUrl = `${apiOrigin}/api/workspaces/${instanceId}/serve/${relativePath}`

                console.log(`[Qwen] Auto-preview triggered for ${relativePath}`);
                console.log(`[EVENT] Auto-preview triggered for ${previewUrl}`);
                window.dispatchEvent(new CustomEvent(BUILD_PREVIEW_EVENT, {
                  detail: { url: previewUrl, instanceId }
                }))
              }
            }
          }
          return
        }

        const delta =
          chunk?.choices?.[0]?.delta?.content ??
          chunk?.choices?.[0]?.message?.content
        if (typeof delta !== "string" || delta.length === 0) return
        fullText += delta

        const now = Date.now()
        if (now - lastUpdateAt > 40) { // Limit to ~25 updates per second
          lastUpdateAt = now
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })
        }
      } catch {
        // Ignore malformed chunks
      }
    })

    // Always apply final text update
    store.applyPartUpdate({
      messageId: assistantMessageId,
      part: { id: assistantPartId, type: "text", text: fullText } as any,
    })
  } finally {
    clearTimeout(timeoutId)
    store.endStreamingUpdate()
  }

  store.upsertMessage({
    id: assistantMessageId,
    sessionId,
    role: "assistant",
    status: "complete",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
  store.setMessageInfo(assistantMessageId, {
    id: assistantMessageId,
    role: "assistant",
    providerID: providerId,
    modelID: modelId,
    time: { created: store.getMessageInfo(assistantMessageId)?.time?.created ?? Date.now(), completed: Date.now() },
  } as any)
  store.upsertMessage({
    id: messageId,
    sessionId,
    role: "user",
    status: "sent",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
}

async function streamOpenCodeZenChat(
  instanceId: string,
  sessionId: string,
  providerId: string,
  modelId: string,
  messages: ExternalChatMessage[],
  messageId: string,
  assistantMessageId: string,
  assistantPartId: string,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)

  // Get workspace path for tool execution
  const instance = instances().get(instanceId)
  const workspacePath = instance?.folder || ""

  const response = await fetch("/api/opencode-zen/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      workspacePath,
      enableTools: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `OpenCode Zen chat failed (${response.status})`)
  }

  const store = messageStoreBus.getOrCreate(instanceId)
  store.beginStreamingUpdate()
  let fullText = ""
  let lastUpdateAt = 0

  try {
    await readSseStream(response, (data) => {
      try {
        const chunk = JSON.parse(data)
        if (chunk?.error) {
          throw new Error(typeof chunk.error === "string" ? chunk.error : "OpenCode Zen streaming error")
        }

        // Handle tool execution results (special events from backend)
        if (chunk?.type === "tool_result") {
          const toolResult = `\n\n✅ **Tool Executed:** ${chunk.content}\n\n`
          fullText += toolResult
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })

          // Dispatch file change event to refresh sidebar
          if (typeof window !== "undefined") {
            console.log(`[Ollama] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            console.log(`[EVENT] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            window.dispatchEvent(new CustomEvent(FILE_CHANGE_EVENT, { detail: { instanceId } }))
          }

          // Auto-trigger preview for HTML file writes
          const content = chunk.content || ""
          if (content.includes("Successfully wrote") &&
            (content.includes(".html") || content.includes("index.") || content.includes(".htm"))) {
            if (typeof window !== "undefined") {
              const htmlMatch = content.match(/to\s+([^\s]+\.html?)/)
              if (htmlMatch) {
                const relativePath = htmlMatch[1]
                // USE PROXY URL instead of file:// to avoid "Not allowed to load local resource"
                // The backend (port 9898) serves workspace files via /api/workspaces/:id/serve
                const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
                const apiOrigin = origin.replace(":3000", ":9898") // Fallback assumption
                const previewUrl = `${apiOrigin}/api/workspaces/${instanceId}/serve/${relativePath}`

                console.log(`[Ollama] Auto-preview triggered for ${relativePath}`);
                console.log(`[EVENT] Auto-preview triggered for ${previewUrl}`);
                window.dispatchEvent(new CustomEvent(BUILD_PREVIEW_EVENT, {
                  detail: { url: previewUrl, instanceId }
                }))
              }
            }
          }

          return
        }

        const delta =
          chunk?.choices?.[0]?.delta?.content ??
          chunk?.choices?.[0]?.message?.content
        if (typeof delta !== "string" || delta.length === 0) return
        fullText += delta

        const now = Date.now()
        if (now - lastUpdateAt > 40) { // Limit to ~25 updates per second
          lastUpdateAt = now
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }
      }
    })

    // Always apply final text update
    store.applyPartUpdate({
      messageId: assistantMessageId,
      part: { id: assistantPartId, type: "text", text: fullText } as any,
    })
  } finally {
    clearTimeout(timeoutId)
    store.endStreamingUpdate()
  }


  store.upsertMessage({
    id: assistantMessageId,
    sessionId,
    role: "assistant",
    status: "complete",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
  store.setMessageInfo(assistantMessageId, {
    id: assistantMessageId,
    role: "assistant",
    providerID: providerId,
    modelID: modelId,
    time: { created: store.getMessageInfo(assistantMessageId)?.time?.created ?? Date.now(), completed: Date.now() },
  } as any)
  store.upsertMessage({
    id: messageId,
    sessionId,
    role: "user",
    status: "sent",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
}

async function streamZAIChat(
  instanceId: string,
  sessionId: string,
  providerId: string,
  modelId: string,
  messages: ExternalChatMessage[],
  messageId: string,
  assistantMessageId: string,
  assistantPartId: string,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)

  // Get workspace path for tool execution
  const instance = instances().get(instanceId)
  const workspacePath = instance?.folder || ""

  const response = await fetch("/api/zai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      workspacePath,
      enableTools: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Z.AI chat failed (${response.status})`)
  }

  const store = messageStoreBus.getOrCreate(instanceId)
  store.beginStreamingUpdate()
  let fullText = ""
  let lastUpdateAt = 0

  try {
    await readSseStream(response, (data) => {
      try {
        const chunk = JSON.parse(data)
        if (chunk?.error) throw new Error(chunk.error)

        // Handle tool execution results (special events from backend)
        if (chunk?.type === "tool_result") {
          const toolResult = `\n\n✅ **Tool Executed:** ${chunk.content}\n\n`
          fullText += toolResult
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })

          // Dispatch file change event to refresh sidebar
          if (typeof window !== "undefined") {
            console.log(`[EVENT] Dispatching FILE_CHANGE_EVENT for ${instanceId}`);
            window.dispatchEvent(new CustomEvent(FILE_CHANGE_EVENT, { detail: { instanceId } }))
          }

          // Auto-trigger preview for HTML file writes
          const content = chunk.content || ""
          if (content.includes("Successfully wrote") &&
            (content.includes(".html") || content.includes("index.") || content.includes(".htm"))) {
            if (typeof window !== "undefined") {
              const htmlMatch = content.match(/to\s+([^\s]+\.html?)/)
              if (htmlMatch) {
                const relativePath = htmlMatch[1]
                const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
                const apiOrigin = origin.replace(":3000", ":9898")
                const previewUrl = `${apiOrigin}/api/workspaces/${instanceId}/serve/${relativePath}`

                console.log(`[EVENT] Auto-preview triggered for ${previewUrl}`);
                window.dispatchEvent(new CustomEvent(BUILD_PREVIEW_EVENT, {
                  detail: { url: previewUrl, instanceId }
                }))
              }
            }
          }

          return
        }

        const delta =
          chunk?.choices?.[0]?.delta?.content ??
          chunk?.choices?.[0]?.message?.content
        if (typeof delta !== "string" || delta.length === 0) return
        fullText += delta

        const now = Date.now()
        if (now - lastUpdateAt > 40) { // Limit to ~25 updates per second
          lastUpdateAt = now
          store.applyPartUpdate({
            messageId: assistantMessageId,
            part: { id: assistantPartId, type: "text", text: fullText } as any,
          })
        }
      } catch (e) {
        if (e instanceof Error) throw e
      }
    })

    // Always apply final text update
    store.applyPartUpdate({
      messageId: assistantMessageId,
      part: { id: assistantPartId, type: "text", text: fullText } as any,
    })
  } finally {
    clearTimeout(timeoutId)
    store.endStreamingUpdate()
  }

  store.upsertMessage({
    id: assistantMessageId,
    sessionId,
    role: "assistant",
    status: "complete",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
  store.setMessageInfo(assistantMessageId, {
    id: assistantMessageId,
    role: "assistant",
    providerID: providerId,
    modelID: modelId,
    time: { created: store.getMessageInfo(assistantMessageId)?.time?.created ?? Date.now(), completed: Date.now() },
  } as any)
  store.upsertMessage({
    id: messageId,
    sessionId,
    role: "user",
    status: "sent",
    updatedAt: Date.now(),
    isEphemeral: false,
  })
}

async function sendMessage(
  instanceId: string,
  sessionId: string,
  prompt: string,
  attachments: any[] = [],
  taskId?: string,
): Promise<string> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  let effectiveModel = session.model
  if (!isModelValid(instanceId, effectiveModel)) {
    const fallback = await getDefaultModel(instanceId, session.agent || undefined)
    if (isModelValid(instanceId, fallback)) {
      await updateSessionModel(instanceId, sessionId, fallback)
      effectiveModel = fallback
    }
  }

  const sessionForLimits = { ...session, model: effectiveModel }
  const canSend = await checkTokenBudgetBeforeSend(instanceId, sessionId, sessionForLimits)
  if (!canSend) {
    return ""
  }

  const messageId = createId("msg")

  // If taskId is provided, associate this message with the task and set it as active
  if (taskId) {
    addTaskMessage(instanceId, sessionId, taskId, messageId)
    withSession(instanceId, sessionId, (session) => {
      session.activeTaskId = taskId
    })
  } else {
    // If no taskId, we might want to clear activeTaskId to go back to global chat
    // or keep it if we are still "in" a task view.
    // For isolation, it's better to clear it if a global message is sent.
    withSession(instanceId, sessionId, (session) => {
      session.activeTaskId = undefined
    })
  }

  const textPartId = createId("part")

  const resolvedPrompt = resolvePastedPlaceholders(prompt, attachments)

  const optimisticParts: any[] = [
    {
      id: textPartId,
      type: "text" as const,
      text: resolvedPrompt,
      synthetic: false,
      renderCache: undefined,
    },
  ]

  const requestParts: any[] = [
    {
      id: textPartId,
      type: "text" as const,
      text: resolvedPrompt,
    },
  ]

  if (attachments.length > 0) {
    for (const att of attachments) {
      const source = att.source
      if (source.type === "file") {
        const partId = createId("part")
        requestParts.push({
          id: partId,
          type: "file" as const,
          url: att.url,
          mime: source.mime,
          filename: att.filename,
        })
        optimisticParts.push({
          id: partId,
          type: "file" as const,
          url: att.url,
          mime: source.mime,
          filename: att.filename,
          synthetic: true,
        })
      } else if (source.type === "text") {
        const display: string | undefined = att.display
        const value: unknown = source.value
        const isPastedPlaceholder = typeof display === "string" && /^pasted #\d+/.test(display)

        if (isPastedPlaceholder || typeof value !== "string") {
          continue
        }

        const partId = createId("part")
        requestParts.push({
          id: partId,
          type: "text" as const,
          text: value,
        })
        optimisticParts.push({
          id: partId,
          type: "text" as const,
          text: value,
          synthetic: true,
          renderCache: undefined,
        })
      }
    }
  }

  const store = messageStoreBus.getOrCreate(instanceId)
  const createdAt = Date.now()

  log.info("sendMessage: upserting optimistic message", { messageId, sessionId, taskId });

  untrack(() => {
    store.upsertMessage({
      id: messageId,
      sessionId,
      role: "user",
      status: "sending",
      parts: optimisticParts,
      createdAt,
      updatedAt: createdAt,
      isEphemeral: true,
    })
  })

  withSession(instanceId, sessionId, () => {
    /* trigger reactivity for legacy session data */
  })

  const providerId = effectiveModel.providerId
  const tPre1 = performance.now()
  const systemMessage = await untrack(() => mergeSystemInstructions(instanceId, sessionId, prompt))
  const tPre2 = performance.now()
  if (tPre2 - tPre1 > 10) {
    addDebugLog(`Merge System Instructions: ${Math.round(tPre2 - tPre1)}ms`, "warn")
  }

  if (providerId === "ollama-cloud" || providerId === "qwen-oauth" || providerId === "opencode-zen" || providerId === "zai") {
    const store = messageStoreBus.getOrCreate(instanceId)
    const now = Date.now()
    const assistantMessageId = createId("msg")
    const assistantPartId = createId("part")

    const tMsg1 = performance.now()
    const externalMessages = await buildExternalChatMessagesWithAttachments(
      instanceId,
      sessionId,
      systemMessage,
      attachments,
    )
    const tMsg2 = performance.now()
    if (tMsg2 - tMsg1 > 10) {
      addDebugLog(`Build External Messages: ${Math.round(tMsg2 - tMsg1)}ms`, "warn")
    }

    untrack(() => {
      store.upsertMessage({
        id: assistantMessageId,
        sessionId,
        role: "assistant",
        status: "streaming",
        parts: [{ id: assistantPartId, type: "text", text: "" } as any],
        createdAt: now,
        updatedAt: now,
        isEphemeral: true,
      })
      store.setMessageInfo(assistantMessageId, {
        id: assistantMessageId,
        role: "assistant",
        providerID: effectiveModel.providerId,
        modelID: effectiveModel.modelId,
        time: { created: now, completed: 0 },
      } as any)
      store.upsertMessage({
        id: messageId,
        sessionId,
        role: "user",
        status: "sent",
        updatedAt: now,
        isEphemeral: false,
      })
    })

    try {
      if (providerId === "ollama-cloud") {
        const tStream1 = performance.now()
        await streamOllamaChat(
          instanceId,
          sessionId,
          providerId,
          effectiveModel.modelId,
          externalMessages,
          messageId,
          assistantMessageId,
          assistantPartId,
        )
        const tStream2 = performance.now()
        addDebugLog(`Stream Complete: ${Math.round(tStream2 - tStream1)}ms`, "info")
      } else if (providerId === "opencode-zen") {
        await streamOpenCodeZenChat(
          instanceId,
          sessionId,
          providerId,
          effectiveModel.modelId,
          externalMessages,
          messageId,
          assistantMessageId,
          assistantPartId,
        )
      } else if (providerId === "zai") {
        await streamZAIChat(
          instanceId,
          sessionId,
          providerId,
          effectiveModel.modelId,
          externalMessages,
          messageId,
          assistantMessageId,
          assistantPartId,
        )
      } else {
        const qwenManager = new QwenOAuthManager()
        const token = await qwenManager.getValidToken()
        if (!token?.access_token) {
          showToastNotification({
            title: "Qwen OAuth unavailable",
            message: "Please sign in to Qwen Code again to refresh your token.",
            variant: "warning",
            duration: 8000,
          })
          store.upsertMessage({
            id: messageId,
            sessionId,
            role: "user",
            status: "error",
            updatedAt: Date.now(),
          })
          store.upsertMessage({
            id: assistantMessageId,
            sessionId,
            role: "assistant",
            status: "error",
            updatedAt: Date.now(),
            isEphemeral: false,
          })
          return messageId
        }

        await streamQwenChat(
          instanceId,
          sessionId,
          providerId,
          effectiveModel.modelId,
          externalMessages,
          token.access_token,
          token.resource_url,
          messageId,
          assistantMessageId,
          assistantPartId,
        )
      }
      return messageId
    } catch (error: any) {
      if (providerId === "opencode-zen") {
        const message = String(error?.message || "")
        const match = message.match(/Model\s+([A-Za-z0-9._-]+)\s+not supported/i)
        if (match?.[1]) {
          markOpencodeZenModelOffline(match[1])
        }
      }
      store.upsertMessage({
        id: messageId,
        sessionId,
        role: "user",
        status: "error",
        updatedAt: Date.now(),
      })
      store.upsertMessage({
        id: assistantMessageId,
        sessionId,
        role: "assistant",
        status: "error",
        updatedAt: Date.now(),
        isEphemeral: false,
      })
      store.setMessageInfo(assistantMessageId, {
        id: assistantMessageId,
        role: "assistant",
        providerID: effectiveModel.providerId,
        modelID: effectiveModel.modelId,
        time: { created: now, completed: Date.now() },
        error: { name: "UnknownError", message: error?.message || "Request failed" },
      } as any)
      showToastNotification({
        title:
          providerId === "ollama-cloud"
            ? "Ollama request failed"
            : providerId === "zai"
              ? "Z.AI request failed"
              : providerId === "opencode-zen"
                ? "OpenCode Zen request failed"
                : "Qwen request failed",
        message: error?.message || "Request failed",
        variant: "error",
        duration: 8000,
      })
      throw error
    }
  }

  const requestBody = {
    messageID: messageId,
    parts: requestParts,
    ...(session.agent && { agent: session.agent }),
    ...(effectiveModel.providerId &&
      effectiveModel.modelId && {
      model: {
        providerID: effectiveModel.providerId,
        modelID: effectiveModel.modelId,
      },
    }),
    ...(systemMessage && { system: systemMessage }),
  }

  log.info("sendMessage", {
    instanceId,
    sessionId,
    requestBody,
  })

  // Electron diagnostic logging
  if (typeof window !== "undefined" && (window as any).electron) {
    log.info("Electron environment detected", {
      isElectron: true,
      userAgent: navigator.userAgent,
      origin: window.location.origin
    })
  }

  try {
    log.info("session.promptAsync starting", { instanceId, sessionId, providerId: session.model.providerId })

    // Add timeout to prevent infinite hanging
    const timeoutMs = 60000 // 60 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s. The model provider may not be available.`)), timeoutMs)
    })

    const promptPromise = instance.client.session.promptAsync({
      path: { id: sessionId },
      body: requestBody,
    })

    const response = await Promise.race([promptPromise, timeoutPromise])
    log.info("session.promptAsync success", { instanceId, sessionId, response })
    return messageId
  } catch (error: any) {
    log.error("Failed to send prompt", {
      instanceId,
      sessionId,
      error: error?.message || error,
      stack: error?.stack,
      requestBody
    })

    // Update message status to error in store
    const store = messageStoreBus.getOrCreate(instanceId)
    store.upsertMessage({
      id: messageId,
      sessionId,
      role: "user",
      status: "error",
      updatedAt: Date.now(),
    })

    // Show user-friendly error notification
    showToastNotification({
      title: "Message failed",
      message: error?.message || "Failed to send message. Check your model configuration.",
      variant: "error",
      duration: 8000,
    })

    throw error

  }
}

async function executeCustomCommand(
  instanceId: string,
  sessionId: string,
  commandName: string,
  args: string,
): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const session = sessions().get(instanceId)?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  const body: {
    command: string
    arguments: string
    messageID: string
    agent?: string
    model?: string
  } = {
    command: commandName,
    arguments: args,
    messageID: createId("msg"),
  }

  if (session.agent) {
    body.agent = session.agent
  }

  if (session.model.providerId && session.model.modelId) {
    body.model = `${session.model.providerId}/${session.model.modelId}`
  }

  await instance.client.session.command({
    path: { id: sessionId },
    body,
  })
}

async function runShellCommand(instanceId: string, sessionId: string, command: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const session = sessions().get(instanceId)?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  const agent = session.agent || "build"
  let resolvedCommand = command

  if (command.trim() === "build") {
    try {
      const response = await serverApi.fetchAvailablePort()
      if (response?.port) {
        const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)
        resolvedCommand = isWindows ? `set PORT=${response.port}&& ${command}` : `PORT=${response.port} ${command}`
        if (typeof window !== "undefined") {
          const url = `http://localhost:${response.port}`
          window.dispatchEvent(new CustomEvent(BUILD_PREVIEW_EVENT, { detail: { url, instanceId } }))
        }
      }
    } catch (error) {
      log.warn("Failed to resolve available port for build", { error })
    }
  }

  await instance.client.session.shell({
    path: { id: sessionId },
    body: {
      agent,
      command: resolvedCommand,
    },
  })
}

async function abortSession(instanceId: string, sessionId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  log.info("abortSession", { instanceId, sessionId })

  try {
    log.info("session.abort", { instanceId, sessionId })
    await instance.client.session.abort({
      path: { id: sessionId },
    })
    log.info("abortSession complete", { instanceId, sessionId })
  } catch (error) {
    log.error("Failed to abort session", error)
    throw error
  }
}

async function compactSession(instanceId: string, sessionId: string): Promise<CompactionResult> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    return {
      success: false,
      mode: "compact",
      human_summary: "Instance not ready",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    return {
      success: false,
      mode: "compact",
      human_summary: "Session not found",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const store = messageStoreBus.getInstance(instanceId)
  const messageCount = store?.getSessionMessageIds(sessionId)?.length ?? 0
  if (messageCount <= 2) {
    log.info("compactSession: Session too small to compact", { instanceId, sessionId, count: messageCount })
    return {
      success: true,
      mode: "compact",
      human_summary: "Session too small to compact",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const usageBefore = store?.getSessionUsage(sessionId)
  const tokenBefore = usageBefore
    ? (usageBefore.totalInputTokens || 0) + (usageBefore.totalOutputTokens || 0) + (usageBefore.totalReasoningTokens || 0)
    : 0

  log.info("compactSession: Running local compaction", { instanceId, sessionId, messageCount })
  setSessionCompactionState(instanceId, sessionId, true)
  compactionAttemptState.set(getWarningKey(instanceId, sessionId), {
    timestamp: Date.now(),
    suppressContextError: true,
  })

  try {
    const result = await executeCompactionWrapper(instanceId, sessionId, "compact")
    if (!result.success) {
      return result
    }

    const compactedSession = await createSession(instanceId, session.agent || undefined)

    if (session.model.providerId && session.model.modelId) {
      await updateSessionModel(instanceId, compactedSession.id, {
        providerId: session.model.providerId,
        modelId: session.model.modelId,
      })
    }

    if (session.tasks && session.tasks.length > 0) {
      const tasksCopy = session.tasks.map((task) => ({ ...task }))
      withSession(instanceId, compactedSession.id, (nextSession) => {
        nextSession.tasks = tasksCopy
        nextSession.activeTaskId = session.activeTaskId
      })
    }

    if (session.parentId) {
      withSession(instanceId, compactedSession.id, (nextSession) => {
        nextSession.parentId = session.parentId
      })
      withSession(instanceId, session.parentId, (parentSession) => {
        if (!parentSession.tasks) return
        parentSession.tasks = parentSession.tasks.map((task) => (
          task.taskSessionId === sessionId
            ? { ...task, taskSessionId: compactedSession.id }
            : task
        ))
      })
    }

    const summaryText = buildCompactionSeed(result)
    const summaryMessageId = createId("msg")
    const summaryPartId = createId("part")

    await instance.client.session.promptAsync({
      path: { id: compactedSession.id },
      body: {
        messageID: summaryMessageId,
        agent: session.agent || undefined,
        model: session.model.providerId && session.model.modelId
          ? { providerID: session.model.providerId, modelID: session.model.modelId }
          : undefined,
        noReply: true,
        system: "You are continuing from a compacted session. Use the summary below as context.",
        parts: [
          {
            id: summaryPartId,
            type: "text",
            text: summaryText,
          },
        ],
      },
    })

    if (session.parentId) {
      setActiveSession(instanceId, compactedSession.id)
    } else {
      setActiveParentSession(instanceId, compactedSession.id)
    }
    await loadMessages(instanceId, compactedSession.id, true)
    updateSessionInfo(instanceId, compactedSession.id)

    showToastNotification({
      title: "Session compacted",
      message: "Created a new compacted session with a summary to continue work.",
      variant: "success",
      duration: 8000,
    })

    log.info("compactSession: Complete", { instanceId, sessionId, compactedSessionId: compactedSession.id })
    clearCompactionSuggestion(instanceId, sessionId)
    return {
      ...result,
      token_before: tokenBefore,
    }
  } catch (error) {
    log.error("compactSession: Failed to compact session", { instanceId, sessionId, error })
    return {
      success: false,
      mode: "compact",
      human_summary: "Compaction failed",
      token_before: tokenBefore,
      token_after: tokenBefore,
      token_reduction_pct: 0,
    }
  } finally {
    compactionAttemptState.delete(getWarningKey(instanceId, sessionId))
    setSessionCompactionState(instanceId, sessionId, false)
  }
}

async function updateSessionAgent(instanceId: string, sessionId: string, agent: string): Promise<void> {
  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  const agentModelPreference = await getAgentModelPreference(instanceId, agent)
  const defaultModel = await getDefaultModel(instanceId, agent)
  const nextModel = agentModelPreference || defaultModel
  const shouldApplyModel = isModelValid(instanceId, nextModel)

  withSession(instanceId, sessionId, (current) => {
    current.agent = agent
    if (shouldApplyModel) {
      current.model = nextModel
    }
  })

  if (agent && shouldApplyModel && !agentModelPreference) {
    await setAgentModelPreference(instanceId, agent, nextModel)
  }

  if (shouldApplyModel) {
    updateSessionInfo(instanceId, sessionId)
  }
}

async function updateSessionModel(
  instanceId: string,
  sessionId: string,
  model: { providerId: string; modelId: string },
): Promise<void> {
  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  if (!isModelValid(instanceId, model)) {
    log.warn("Invalid model selection", model)
    return
  }

  withSession(instanceId, sessionId, (current) => {
    current.model = model
  })

  const propagateModel = (targetSessionId?: string | null) => {
    if (!targetSessionId || targetSessionId === sessionId) return
    withSession(instanceId, targetSessionId, (current) => {
      current.model = model
    })
    updateSessionInfo(instanceId, targetSessionId)
  }

  if (session.parentId) {
    propagateModel(session.parentId)
  }

  if (session.tasks && session.tasks.length > 0) {
    const seen = new Set<string>()
    for (const task of session.tasks) {
      if (!task.taskSessionId || seen.has(task.taskSessionId)) continue
      seen.add(task.taskSessionId)
      propagateModel(task.taskSessionId)
    }
  }

  if (session.agent) {
    await setAgentModelPreference(instanceId, session.agent, model)
  }
  addRecentModelPreference(model)

  updateSessionInfo(instanceId, sessionId)
}

async function updateSessionModelForSession(
  instanceId: string,
  sessionId: string,
  model: { providerId: string; modelId: string },
): Promise<void> {
  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  if (!isModelValid(instanceId, model)) {
    log.warn("Invalid model selection", model)
    return
  }

  withSession(instanceId, sessionId, (current) => {
    current.model = model
  })

  addRecentModelPreference(model)
  updateSessionInfo(instanceId, sessionId)
}

async function renameSession(instanceId: string, sessionId: string, nextTitle: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const session = sessions().get(instanceId)?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  const trimmedTitle = nextTitle.trim()
  if (!trimmedTitle) {
    throw new Error("Session title is required")
  }

  await instance.client.session.update({
    path: { id: sessionId },
    body: { title: trimmedTitle },
  })

  withSession(instanceId, sessionId, (current) => {
    current.title = trimmedTitle
    const time = { ...(current.time ?? {}) }
    time.updated = Date.now()
    current.time = time
  })
}

async function revertSession(instanceId: string, sessionId: string): Promise<void> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const session = sessions().get(instanceId)?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  try {
    await instance.client.session.revert({
      path: { id: sessionId },
    })
  } catch (error) {
    log.error("Failed to revert session", error)
    throw error
  }
}

async function forkSession(instanceId: string, sessionId: string): Promise<string> {
  const instance = instances().get(instanceId)
  if (!instance || !instance.client) {
    throw new Error("Instance not ready")
  }

  const session = sessions().get(instanceId)?.get(sessionId)
  if (!session) {
    throw new Error("Session not found")
  }

  try {
    const response = await instance.client.session.fork({
      path: { id: sessionId },
    })

    if (response.error) {
      throw new Error(JSON.stringify(response.error) || "Failed to fork session")
    }

    const newSessionId = response.data?.id
    if (!newSessionId) {
      throw new Error("No session ID returned from fork operation")
    }

    return newSessionId
  } catch (error) {
    log.error("Failed to fork session", error)
    throw error
  }
}

// Forcefully reset streaming state to unlock UI if stuck
function forceReset() {
  const store = messageStoreBus.getOrCreate(activeInstanceId() || "")
  if (!store) return

  // Reset streaming count forcefully
  // We don't have direct access to set count to 0, so we call end enough times
  // or we assume we can just ignore it for now, but really we should expose a reset method.
  // For now, let's just log and clear pending parts.
  store.setState("pendingParts", {})

  // If we could access the store's internal streaming count setter that would be better.
  // Since we added `isStreaming` and `endStreamingUpdate` to store interface,
  // we can just call end multiple times if we suspect it's stuck > 0
  let safety = 0
  while (store.state.streamingUpdateCount > 0 && safety < 100) {
    store.endStreamingUpdate()
    safety++
  }

  // Also reset message statuses
  try {
    const messages = store.state.messages;
    Object.values(messages).forEach(msg => {
      if (msg.status === "streaming" || msg.status === "sending") {
        store.upsertMessage({
          id: msg.id,
          sessionId: msg.sessionId,
          role: msg.role,
          status: "interrupted",
          updatedAt: Date.now(),
          isEphemeral: msg.isEphemeral,
        })
      }
    })
  } catch (e) {
    console.error("Error updating message status during reset", e)
  }

  addDebugLog("Force Reset Triggered: Cleared streaming state & statuses", "warn")
}

export {
  abortSession,
  compactSession,
  executeCustomCommand,
  forkSession,
  renameSession,
  revertSession,
  runShellCommand,
  sendMessage,
  updateSessionAgent,
  updateSessionModel,
  updateSessionModelForSession,
  forceReset, // Add to exports
}
