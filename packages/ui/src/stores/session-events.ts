import type {
  MessageInfo,
  MessagePartRemovedEvent,
  MessagePartUpdatedEvent,
  MessageRemovedEvent,
  MessageUpdateEvent,
} from "../types/message"
import type {
  EventPermissionReplied,
  EventPermissionUpdated,
  EventSessionCompacted,
  EventSessionError,
  EventSessionIdle,
  EventSessionUpdated,
} from "@opencode-ai/sdk"
import type { MessageStatus } from "./message-v2/types"

import { getLogger } from "../lib/logger"
import { showToastNotification, ToastVariant } from "../lib/notifications"
import { instances, addPermissionToQueue, removePermissionFromQueue, sendPermissionResponse } from "./instances"
import { getSoloState, incrementStep, popFromTaskQueue, setActiveTaskId, canPerformAutonomousAction, recordAutonomousAction, resetErrorRecovery, clearContinuationFlag } from "./solo-store"
import { sendMessage, consumeTokenWarningSuppression, consumeCompactionSuppression, updateSessionModel } from "./session-actions"
import { showAlertDialog } from "./alerts"
import { sessions, setSessions, withSession } from "./session-state"
import { normalizeMessagePart } from "./message-v2/normalizers"
import { updateSessionInfo } from "./message-v2/session-info"
import { addTaskMessage, replaceTaskMessageId } from "./task-actions"
import { checkAndTriggerAutoCompact, getSessionCompactionState, setCompactionSuggestion } from "./session-compaction"

const log = getLogger("sse")
import { loadMessages } from "./session-api"
import { setSessionCompactionState } from "./session-compaction"
import {
  applyPartUpdateV2,
  replaceMessageIdV2,
  upsertMessageInfoV2,
  upsertPermissionV2,
  removePermissionV2,
  setSessionRevertV2,
} from "./message-v2/bridge"
import { messageStoreBus } from "./message-v2/bus"
import type { InstanceMessageStore } from "./message-v2/instance-store"
import { getDefaultModel } from "./session-models"

interface TuiToastEvent {
  type: "tui.toast.show"
  properties: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
  }
}

const ALLOWED_TOAST_VARIANTS = new Set<ToastVariant>(["info", "success", "warning", "error"])

type MessageRole = "user" | "assistant"

function resolveMessageRole(info?: MessageInfo | null): MessageRole {
  return info?.role === "user" ? "user" : "assistant"
}

function findPendingMessageId(
  store: InstanceMessageStore,
  sessionId: string,
  role: MessageRole,
): string | undefined {
  const messageIds = store.getSessionMessageIds(sessionId)
  const lastId = messageIds[messageIds.length - 1]
  if (!lastId) return undefined
  const record = store.getMessage(lastId)
  if (!record) return undefined
  if (record.sessionId !== sessionId) return undefined
  if (record.role !== role) return undefined
  return record.status === "sending" ? record.id : undefined
}

function handleMessageUpdate(instanceId: string, event: MessageUpdateEvent | MessagePartUpdatedEvent): void {
  const instanceSessions = sessions().get(instanceId)
  if (!instanceSessions) return

  if (event.type === "message.part.updated") {
    const rawPart = event.properties?.part
    if (!rawPart) return

    const part = normalizeMessagePart(rawPart)
    const messageInfo = (event as any)?.properties?.message as MessageInfo | undefined

    const fallbackSessionId = typeof messageInfo?.sessionID === "string" ? messageInfo.sessionID : undefined
    const fallbackMessageId = typeof messageInfo?.id === "string" ? messageInfo.id : undefined

    const sessionId = typeof part.sessionID === "string" ? part.sessionID : fallbackSessionId
    const messageId = typeof part.messageID === "string" ? part.messageID : fallbackMessageId
    if (!sessionId || !messageId) return

    const session = instanceSessions.get(sessionId)
    // Note: session may be null for newly forked sessions where SSE event arrives before session is registered

    const store = messageStoreBus.getOrCreate(instanceId)
    const role: MessageRole = resolveMessageRole(messageInfo)
    const createdAt = typeof messageInfo?.time?.created === "number" ? messageInfo.time.created : Date.now()


    let record = store.getMessage(messageId)
    if (!record) {
      const pendingId = findPendingMessageId(store, sessionId, role)
      if (pendingId && pendingId !== messageId) {
        replaceMessageIdV2(instanceId, pendingId, messageId)
        replaceTaskMessageId(instanceId, sessionId, pendingId, messageId)
        record = store.getMessage(messageId)
      }
    }

    if (!record) {
      store.upsertMessage({
        id: messageId,
        sessionId,
        role,
        status: "streaming",
        createdAt,
        updatedAt: createdAt,
        isEphemeral: true,
      })

      // Try to associate message with task
      if (session?.activeTaskId) {
        addTaskMessage(instanceId, sessionId, session.activeTaskId, messageId)
      } else if (session?.parentId) {
        // This is a task session. Find the parent and update the task.
        const parentSession = instanceSessions.get(session.parentId)
        if (parentSession?.tasks) {
          const task = parentSession.tasks.find((t) => t.taskSessionId === sessionId)
          if (task) {
            addTaskMessage(instanceId, session.parentId, task.id, messageId)
          }
        }
      } else if (!session) {
        // Session not found yet - search all sessions for a task with this sessionId
        for (const [, candidateSession] of instanceSessions) {
          if (candidateSession.tasks) {
            const task = candidateSession.tasks.find((t) => t.taskSessionId === sessionId)
            if (task) {
              addTaskMessage(instanceId, candidateSession.id, task.id, messageId)
              break
            }
          }
        }
      }
    }

    if (messageInfo) {
      upsertMessageInfoV2(instanceId, messageInfo, { status: "streaming" })
    }

    applyPartUpdateV2(instanceId, { ...part, sessionID: sessionId, messageID: messageId })


    updateSessionInfo(instanceId, sessionId)
  } else if (event.type === "message.updated") {
    const info = event.properties?.info
    if (!info) return

    const sessionId = typeof info.sessionID === "string" ? info.sessionID : undefined
    const messageId = typeof info.id === "string" ? info.id : undefined
    if (!sessionId || !messageId) return

    const session = instanceSessions.get(sessionId)
    // Note: session may be null for newly forked sessions where SSE event arrives before session is registered

    const store = messageStoreBus.getOrCreate(instanceId)
    const role: MessageRole = info.role === "user" ? "user" : "assistant"
    const hasError = Boolean((info as any).error)
    const status: MessageStatus = hasError ? "error" : "complete"

    // Auto-correction logic for SOLO
    const solo = getSoloState(instanceId)
    if (hasError && solo.isAutonomous && solo.currentStep < solo.maxSteps) {
      const errorMessage = (info as any).error?.message || "Unknown error"

      // Check if we can perform autonomous error recovery (loop prevention)
      if (!canPerformAutonomousAction(instanceId, "error_recovery")) {
        log.warn("[SOLO] Error recovery blocked by loop prevention", { instanceId, sessionId, errorMessage })
        return
      }

      log.info(`[SOLO] Error detected in autonomous mode, prompting for fix: ${messageId}`)
      incrementStep(instanceId)
      recordAutonomousAction(instanceId, "error_recovery", errorMessage)

      sendMessage(instanceId, sessionId, `The previous step failed with error: ${errorMessage}. Please analyze the error and try a different approach.`, [], solo.activeTaskId || undefined).catch((err) => {
        log.error("[SOLO] Failed to send error correction message", err)
        resetErrorRecovery(instanceId)
      })
    }

    let record = store.getMessage(messageId)
    if (!record) {
      const pendingId = findPendingMessageId(store, sessionId, role)
      if (pendingId && pendingId !== messageId) {
        replaceMessageIdV2(instanceId, pendingId, messageId)
        replaceTaskMessageId(instanceId, sessionId, pendingId, messageId)
        record = store.getMessage(messageId)
      }
    }

    if (!record) {
      const createdAt = info.time?.created ?? Date.now()
      const completedAt = (info.time as { completed?: number } | undefined)?.completed
      store.upsertMessage({
        id: messageId,
        sessionId,
        role,
        status,
        createdAt,
        updatedAt: completedAt ?? createdAt,
      })

      // Try to associate message with task
      if (session?.activeTaskId) {
        addTaskMessage(instanceId, sessionId, session.activeTaskId, messageId)
      } else if (session?.parentId) {
        // This is a task session. Find the parent and update the task.
        const parentSession = instanceSessions.get(session.parentId)
        if (parentSession?.tasks) {
          const task = parentSession.tasks.find((t) => t.taskSessionId === sessionId)
          if (task) {
            addTaskMessage(instanceId, session.parentId, task.id, messageId)
          }
        }
      } else if (!session) {
        // Session not found yet - search all sessions for a task with this sessionId
        for (const [, candidateSession] of instanceSessions) {
          if (candidateSession.tasks) {
            const task = candidateSession.tasks.find((t) => t.taskSessionId === sessionId)
            if (task) {
              addTaskMessage(instanceId, candidateSession.id, task.id, messageId)
              break
            }
          }
        }
      }
    }

    upsertMessageInfoV2(instanceId, info, { status, bumpRevision: true })

    updateSessionInfo(instanceId, sessionId)

    checkAndTriggerAutoCompact(instanceId, sessionId)
      .then((shouldCompact) => {
        if (!shouldCompact) return
        if (getSessionCompactionState(instanceId, sessionId)) return
        setCompactionSuggestion(instanceId, sessionId, "Context usage is high. Compact to continue.")
      })
      .catch((err) => {
        log.error("Failed to check and trigger auto-compact", err)
      })
  }
}

function handleSessionUpdate(instanceId: string, event: EventSessionUpdated): void {
  const info = event.properties?.info

  if (!info) return

  const compactingFlag = info.time?.compacting
  const isCompacting = typeof compactingFlag === "number" ? compactingFlag > 0 : Boolean(compactingFlag)
  setSessionCompactionState(instanceId, info.id, isCompacting)

  const instanceSessions = sessions().get(instanceId)
  if (!instanceSessions) return

  const existingSession = instanceSessions.get(info.id)

  if (!existingSession) {
    const newSession = {
      id: info.id,
      instanceId,
      title: info.title || "Untitled",
      parentId: info.parentID || null,
      agent: "",
      model: {
        providerId: "",
        modelId: "",
      },
      version: info.version || "0",
      time: info.time
        ? { ...info.time }
        : {
          created: Date.now(),
          updated: Date.now(),
        },
    } as any

    setSessions((prev) => {
      const next = new Map(prev)
      const updated = new Map(prev.get(instanceId))
      updated.set(newSession.id, newSession)
      next.set(instanceId, updated)
      return next
    })
    setSessionRevertV2(instanceId, info.id, info.revert ?? null)

    log.info(`[SSE] New session created: ${info.id}`, newSession)
  } else {
    const mergedTime = {
      ...existingSession.time,
      ...(info.time ?? {}),
    }
    if (!info.time?.updated) {
      mergedTime.updated = Date.now()
    }

    const updatedSession = {
      ...existingSession,
      title: info.title || existingSession.title,
      time: mergedTime,
      revert: info.revert
        ? {
          messageID: info.revert.messageID,
          partID: info.revert.partID,
          snapshot: info.revert.snapshot,
          diff: info.revert.diff,
        }
        : existingSession.revert,
    }

    setSessions((prev) => {
      const next = new Map(prev)
      const updated = new Map(prev.get(instanceId))
      updated.set(existingSession.id, updatedSession)
      next.set(instanceId, updated)
      return next
    })
    setSessionRevertV2(instanceId, info.id, info.revert ?? null)
  }
}

function handleSessionIdle(instanceId: string, event: EventSessionIdle): void {
  const sessionId = event.properties?.sessionID
  if (!sessionId) return

  log.info(`[SSE] Session idle: ${sessionId}`)

  // Autonomous continuation logic for SOLO
  const solo = getSoloState(instanceId)
  if (solo.isAutonomous && solo.currentStep < solo.maxSteps) {
    const instanceSessions = sessions().get(instanceId)
    const session = instanceSessions?.get(sessionId)
    if (!session) return

    // If there's an active task, we might want to prompt to agent to continue or check progress
    if (!canPerformAutonomousAction(instanceId, "idle_continuation")) {
      log.warn("[SOLO] Idle continuation blocked by loop prevention", { instanceId, sessionId })
      clearContinuationFlag(instanceId)
      return
    }

    if (solo.activeTaskId) {
      log.info(`[SOLO] Session idle in autonomous mode, prompting continuation for task: ${solo.activeTaskId}`)
      incrementStep(instanceId)
      recordAutonomousAction(instanceId, "idle_continuation")
      sendMessage(instanceId, sessionId, "Continue", [], solo.activeTaskId).catch((err) => {
        log.error("[SOLO] Failed to send continuation message", err)
      })
    } else {
      // Check if there's another task in the queue
      const nextTaskId = popFromTaskQueue(instanceId)
      if (nextTaskId) {
        log.info(`[SOLO] Session idle, starting next task from queue: ${nextTaskId}`)

        // Find the task title to provide context
        let taskTitle = "Start next task"
        const instanceSessions = sessions().get(instanceId)
        const session = instanceSessions?.get(sessionId)
        if (session?.tasks) {
          const task = session.tasks.find(t => t.id === nextTaskId)
          if (task) {
            taskTitle = `Please start working on the task: "${task.title}". Provide a plan and begin execution.`
          }
        }

        setActiveTaskId(instanceId, nextTaskId)
        recordAutonomousAction(instanceId, "idle_continuation")
        sendMessage(instanceId, sessionId, taskTitle, [], nextTaskId).catch((err) => {
          log.error("[SOLO] Failed to start next task", err)
        })
      }
    }
  }
}

function handleSessionCompacted(instanceId: string, event: EventSessionCompacted): void {
  const sessionID = event.properties?.sessionID
  if (!sessionID) return

  log.info(`[SSE] Session compacted: ${sessionID}`)

  setSessionCompactionState(instanceId, sessionID, false)

  withSession(instanceId, sessionID, (session) => {
    const time = { ...(session.time ?? {}) }
    time.compacting = 0
    session.time = time
  })

  loadMessages(instanceId, sessionID, true).catch((error) => log.error("Failed to reload session after compaction", error))

  const instanceSessions = sessions().get(instanceId)
  const session = instanceSessions?.get(sessionID)
  const label = session?.title?.trim() ? session.title : sessionID
  const instanceFolder = instances().get(instanceId)?.folder ?? instanceId
  const instanceName = instanceFolder.split(/[\\/]/).filter(Boolean).pop() ?? instanceFolder

  showToastNotification({
    title: instanceName,
    message: `Session ${label ? `"${label}"` : sessionID} was compacted`,
    variant: "info",
    duration: 10000,
  })
}

function isContextLengthError(error: any): boolean {
  if (!error) return false
  const errorMessage = error.data?.message || error.message || ""
  return (
    errorMessage.includes("maximum context length") ||
    errorMessage.includes("context_length_exceeded") ||
    errorMessage.includes("token count exceeds") ||
    errorMessage.includes("token limit")
  )
}

function isUnsupportedModelMessage(message: string): boolean {
  return /model\s+.+\s+not supported/i.test(message)
}

function handleSessionError(instanceId: string, event: EventSessionError): void {
  const error = event.properties?.error
  log.error(`[SSE] Session error:`, error)

  let message = "Unknown error"

  if (error) {
    if ("data" in error && error.data && typeof error.data === "object" && "message" in error.data) {
      message = error.data.message as string
    } else if ("message" in error && typeof error.message === "string") {
      message = error.message
    }
  }

  // Autonomous error recovery for SOLO
  const solo = getSoloState(instanceId)
  const sessionId = (event.properties as any)?.sessionID

  if (solo.isAutonomous && sessionId && solo.currentStep < solo.maxSteps) {
    const errorMessage = `I encountered an error: "${message}". Please analyze the cause and provide a fix.`

    if (!canPerformAutonomousAction(instanceId, "error_recovery")) {
      log.warn("[SOLO] Error recovery blocked by loop prevention", { instanceId, sessionId, message })
      return
    }

    log.info(`[SOLO] Session error in autonomous mode, prompting fix: ${message}`)
    incrementStep(instanceId)
    recordAutonomousAction(instanceId, "error_recovery", message)
    sendMessage(instanceId, sessionId, errorMessage, [], solo.activeTaskId || undefined).catch((err) => {
      log.error("[SOLO] Failed to send error recovery message", err)
      resetErrorRecovery(instanceId)
    })
    return
  }

  // Check if this is a context length error
  if (isContextLengthError(error)) {
    if (sessionId && consumeCompactionSuppression(instanceId, sessionId)) {
      showAlertDialog("Compaction failed because the model context limit was exceeded. Reduce context or switch to a larger context model, then try compact again.", {
        title: "Compaction failed",
        variant: "error",
      })
      return
    }
    if (sessionId && consumeTokenWarningSuppression(instanceId, sessionId)) {
      showToastNotification({
        title: "Context limit exceeded",
        message: "Compaction is required before continuing.",
        variant: "warning",
        duration: 7000,
      })
      return
    }

    log.info("Context length error detected; suggesting compaction", { instanceId, sessionId })
    if (sessionId) {
      setCompactionSuggestion(instanceId, sessionId, "Context limit exceeded. Compact to continue.")
      showToastNotification({
        title: "Compaction required",
        message: "Click Compact to continue this session.",
        variant: "warning",
        duration: 8000,
      })
    } else {
      showAlertDialog(`Error: ${message}`, {
        title: "Session error",
        variant: "error",
      })
    }
    return
  }

  if (sessionId && isUnsupportedModelMessage(message)) {
    showToastNotification({
      title: "Model not supported",
      message: "Selected model is not supported by this provider. Reverting to a default model.",
      variant: "warning",
      duration: 8000,
    })

    const sessionRecord = sessions().get(instanceId)?.get(sessionId)
    getDefaultModel(instanceId, sessionRecord?.agent)
      .then((fallback) => updateSessionModel(instanceId, sessionId, fallback))
      .catch((err) => log.error("Failed to restore default model after unsupported model error", err))
    return
  }

  // Default error handling
  showAlertDialog(`Error: ${message}`, {
    title: "Session error",
    variant: "error",
  })
}

function handleMessageRemoved(instanceId: string, event: MessageRemovedEvent): void {
  const sessionID = event.properties?.sessionID
  if (!sessionID) return

  log.info(`[SSE] Message removed from session ${sessionID}, reloading messages`)
  loadMessages(instanceId, sessionID, true).catch((error) => log.error("Failed to reload messages after removal", error))
}

function handleMessagePartRemoved(instanceId: string, event: MessagePartRemovedEvent): void {
  const sessionID = event.properties?.sessionID
  if (!sessionID) return

  log.info(`[SSE] Message part removed from session ${sessionID}, reloading messages`)
  loadMessages(instanceId, sessionID, true).catch((error) => log.error("Failed to reload messages after part removal", error))
}

function handleTuiToast(_instanceId: string, event: TuiToastEvent): void {
  const payload = event?.properties
  if (!payload || typeof payload.message !== "string" || typeof payload.variant !== "string") return
  if (!payload.message.trim()) return

  const variant: ToastVariant = ALLOWED_TOAST_VARIANTS.has(payload.variant as ToastVariant)
    ? (payload.variant as ToastVariant)
    : "info"

  showToastNotification({
    title: typeof payload.title === "string" ? payload.title : undefined,
    message: payload.message,
    variant,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
  })
}

function handlePermissionUpdated(instanceId: string, event: EventPermissionUpdated): void {
  const permission = event.properties
  if (!permission) return

  log.info(`[SSE] Permission updated: ${permission.id} (${permission.type})`)
  addPermissionToQueue(instanceId, permission)
  upsertPermissionV2(instanceId, permission)

  // Auto-approval logic for SOLO autonomous agent
  const solo = getSoloState(instanceId)
  if (solo.isAutonomous && solo.autoApproval) {
    log.info(`[SOLO] Auto-approving permission: ${permission.id}`)
    const sessionId = permission.sessionID
    if (sessionId) {
      sendPermissionResponse(instanceId, sessionId, permission.id, "always").catch((err) => {
        log.error(`[SOLO] Failed to auto-approve permission ${permission.id}`, err)
      })
    }
  }
}

function handlePermissionReplied(instanceId: string, event: EventPermissionReplied): void {
  const { permissionID } = event.properties
  if (!permissionID) return

  log.info(`[SSE] Permission replied: ${permissionID}`)
  removePermissionFromQueue(instanceId, permissionID)
  removePermissionV2(instanceId, permissionID)
}

export {
  handleMessagePartRemoved,
  handleMessageRemoved,
  handleMessageUpdate,
  handlePermissionReplied,
  handlePermissionUpdated,
  handleSessionCompacted,
  handleSessionError,
  handleSessionIdle,
  handleSessionUpdate,
  handleTuiToast,
}
