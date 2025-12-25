import { createSignal } from "solid-js"
import { getLogger } from "../lib/logger"

const log = getLogger("solo")

export interface SoloState {
  isAutonomous: boolean
  autoApproval: boolean
  isApex: boolean // New APEX Mode state
  maxSteps: number
  currentStep: number
  activeTaskId: string | null
  taskQueue: string[]
  // Loop prevention fields
  lastActionTimestamp: number
  consecutiveErrorCount: number
  lastErrorHash: string
  isContinuationFromIdle: boolean
}

const [soloStates, setSoloStates] = createSignal<Map<string, SoloState>>(new Map())

export function getSoloState(instanceId: string): SoloState {
  const state = soloStates().get(instanceId)
  if (!state) {
    return {
      isAutonomous: false,
      autoApproval: false,
      isApex: false,
      maxSteps: 50,
      currentStep: 0,
      activeTaskId: null,
      taskQueue: [],
      lastActionTimestamp: 0,
      consecutiveErrorCount: 0,
      lastErrorHash: "",
      isContinuationFromIdle: false,
    }
  }
  return state
}

export function toggleApex(instanceId: string) {
  const current = getSoloState(instanceId)
  setSoloState(instanceId, { isApex: !current.isApex })
  log.info("APEX Mode toggled", { instanceId, isApex: !current.isApex })
}

export function setSoloState(instanceId: string, partial: Partial<SoloState>) {
  setSoloStates((prev) => {
    const next = new Map(prev)
    const current = getSoloState(instanceId)
    next.set(instanceId, { ...current, ...partial })
    return next
  })
}

export function toggleAutonomous(instanceId: string) {
  const current = getSoloState(instanceId)
  setSoloState(instanceId, { isAutonomous: !current.isAutonomous })
  log.info(`Autonomous mode ${!current.isAutonomous ? "enabled" : "disabled"} for ${instanceId}`)
}

export function toggleAutoApproval(instanceId: string) {
  const current = getSoloState(instanceId)
  setSoloState(instanceId, { autoApproval: !current.autoApproval })
  log.info(`Auto-approval ${!current.autoApproval ? "enabled" : "disabled"} for ${instanceId}`)
}

export function incrementStep(instanceId: string) {
  const state = getSoloState(instanceId)
  setSoloState(instanceId, { currentStep: state.currentStep + 1 })
}

export function resetSteps(instanceId: string) {
  setSoloState(instanceId, { currentStep: 0 })
}

export function setActiveTaskId(instanceId: string, taskId: string | null) {
  setSoloState(instanceId, { activeTaskId: taskId })
}

export function addToTaskQueue(instanceId: string, taskId: string) {
  const current = getSoloState(instanceId)
  setSoloState(instanceId, { taskQueue: [...current.taskQueue, taskId] })
}

export function popFromTaskQueue(instanceId: string): string | null {
  const current = getSoloState(instanceId)
  if (current.taskQueue.length === 0) return null
  const [next, ...rest] = current.taskQueue
  setSoloState(instanceId, { taskQueue: rest })
  return next
}

function computeErrorHash(error: string): string {
  const normalized = error.toLowerCase().replace(/\d+/g, "X").replace(/\s+/g, " ")
  return normalized.slice(0, 100)
}

const COOLDOWN_MS = 3000
const MAX_CONSECUTIVE_ERRORS = 3

export function canPerformAutonomousAction(instanceId: string, actionType: "error_recovery" | "idle_continuation"): boolean {
  const state = getSoloState(instanceId)
  const now = Date.now()

  if (actionType === "error_recovery") {
    if (state.consecutiveErrorCount >= MAX_CONSECUTIVE_ERRORS) {
      log.warn("Maximum consecutive errors reached, stopping autonomous error recovery", { instanceId, count: state.consecutiveErrorCount })
      return false
    }
  }

  if (actionType === "idle_continuation" && state.isContinuationFromIdle) {
    log.warn("Already continuing from idle, preventing double continuation", { instanceId })
    return false
  }

  const timeSinceLastAction = now - state.lastActionTimestamp
  if (timeSinceLastAction < COOLDOWN_MS && state.lastActionTimestamp > 0) {
    log.warn("Cooldown period active, delaying autonomous action", { instanceId, timeSinceLastAction })
    return false
  }

  return true
}

export function recordAutonomousAction(instanceId: string, actionType: "error_recovery" | "idle_continuation", errorMessage?: string): void {
  const state = getSoloState(instanceId)
  const now = Date.now()

  if (actionType === "error_recovery" && errorMessage) {
    const errorHash = computeErrorHash(errorMessage)
    const newErrorCount = errorHash === state.lastErrorHash ? state.consecutiveErrorCount + 1 : 1

    setSoloState(instanceId, {
      lastActionTimestamp: now,
      consecutiveErrorCount: newErrorCount,
      lastErrorHash: errorHash,
    })
  } else if (actionType === "idle_continuation") {
    setSoloState(instanceId, {
      lastActionTimestamp: now,
      isContinuationFromIdle: true,
    })
  } else {
    setSoloState(instanceId, {
      lastActionTimestamp: now,
    })
  }
}

export function clearContinuationFlag(instanceId: string): void {
  const state = getSoloState(instanceId)
  if (state.isContinuationFromIdle) {
    setSoloState(instanceId, { isContinuationFromIdle: false })
  }
}

export function resetErrorRecovery(instanceId: string): void {
  setSoloState(instanceId, {
    consecutiveErrorCount: 0,
    lastErrorHash: "",
  })
}
