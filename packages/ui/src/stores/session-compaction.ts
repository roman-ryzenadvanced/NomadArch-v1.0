import { createSignal } from "solid-js"
import { getLogger } from "../lib/logger.js"
import { messageStoreBus } from "./message-v2/bus.js"
import { redactSecrets } from "../lib/secrets-detector.js"
import { validateCompactionEvent, validateCompactionResult, sanitizeStructuredSummary, type CompactionEvent, type CompactionResult, type StructuredSummary } from "../lib/compaction-schema.js"

export type { CompactionEvent, CompactionResult, StructuredSummary } from "../lib/compaction-schema.js"

const log = getLogger("compaction")

export interface CompactionMessageFlags {
  summary: true
  mode: "compaction"
  provenance: "compaction_agent_v2"
}

export interface CompactionConfig {
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  compactPreserveWindow: number
  pruneReclaimThreshold: number
  userPreference: "auto" | "ask" | "never"
  undoRetentionWindow: number
  recentMessagesToKeep: number
  systemMessagesToKeep: number
  incrementalChunkSize: number
  // ADK-style sliding window compaction
  compactionInterval: number      // Trigger after N new messages (ADK: compaction_interval)
  overlapSize: number             // Messages to overlap between windows for continuity
  enableAiSummarization: boolean  // Use AI model for intelligent summarization
  summaryMaxTokens: number        // Max tokens for generated summary
  preserveFileOperations: boolean // Always preserve file-related messages
  preserveDecisions: boolean      // Always preserve decision messages
}

export interface SessionCompactingHook {
  (window: any[], metadata: { sessionId: string; usage: any }): { preserve: string[]; additionalFields?: Record<string, any> }
}

export interface CompactionSuggestion {
  reason: string
  timestamp: number
}

export const sessionCompactingHooks: SessionCompactingHook[] = []

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  autoCompactEnabled: true,
  autoCompactThreshold: 75,           // Trigger at 75% context usage
  compactPreserveWindow: 40000,
  pruneReclaimThreshold: 20000,
  userPreference: "ask",
  undoRetentionWindow: 10,            // Keep last 10 snapshots
  recentMessagesToKeep: 10,           // Keep last 10 messages in full
  systemMessagesToKeep: 3,            // Keep last 3 system messages
  incrementalChunkSize: 20,
  // ADK-style settings
  compactionInterval: 50,             // Check every 50 messages
  overlapSize: 5,                      // Keep 5 messages overlap for continuity
  enableAiSummarization: true,         // Use AI for smart summaries
  summaryMaxTokens: 2000,              // Cap summary at 2000 tokens
  preserveFileOperations: true,        // Always keep file-related context
  preserveDecisions: true,             // Always keep decision context
}

const [compactionConfig, setCompactionConfig] = createSignal<CompactionConfig>({ ...DEFAULT_COMPACTION_CONFIG })
const [compactionHistory, setCompactionHistory] = createSignal<Map<string, CompactionEvent[]>>(new Map())
const [compactionSnapshots, setCompactionSnapshots] = createSignal<Map<string, Map<string, any>>>(new Map())
const [sessionCompactingStates, setSessionCompactingStates] = createSignal<Map<string, boolean>>(new Map())
const [compactionSuggestions, setCompactionSuggestions] = createSignal<Map<string, CompactionSuggestion>>(new Map())

const ENABLE_SMART_COMPACTION = typeof process !== "undefined" && process.env.ENABLE_SMART_COMPACTION === "true"

export function getCompactionConfig(): CompactionConfig {
  return compactionConfig()
}

export function updateCompactionConfig(updates: Partial<CompactionConfig>): void {
  setCompactionConfig((prev) => ({ ...prev, ...updates }))
}

function isOverflowDetected(usage: any, modelLimit: number): boolean {
  if (!usage || !modelLimit) return false
  const totalUsed = (usage.totalInputTokens || 0) + (usage.totalOutputTokens || 0) + (usage.totalReasoningTokens || 0)
  const threshold = modelLimit * compactionConfig().autoCompactThreshold / 100
  return totalUsed >= threshold
}

function shouldPruneToolOutputs(usage: any): boolean {
  if (!usage) return false
  return (usage.toolOutputTokens || 0) > compactionConfig().pruneReclaimThreshold
}

export function estimateTokenReduction(before: number, after: number): number {
  if (before === 0) return 0
  return Math.round(((before - after) / before) * 100)
}

export async function recordCompactionEvent(sessionId: string, event: CompactionEvent): Promise<void> {
  log.info("Recording compaction event", { sessionId, event_id: event.event_id })
  setCompactionHistory((prev) => {
    const next = new Map(prev)
    const sessionHistory = next.get(sessionId) || []
    next.set(sessionId, [...sessionHistory, event])
    return next
  })
}

async function createCompactionSnapshot(instanceId: string, sessionId: string): Promise<string | undefined> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) {
    log.warn("Cannot create snapshot: instance not found", { instanceId, sessionId })
    return undefined
  }

  const messageIds = store.getSessionMessageIds(sessionId)
  const snapshot: Map<string, any> = new Map()

  for (const messageId of messageIds) {
    const message = store.getMessage(messageId)
    if (message) {
      snapshot.set(messageId, JSON.parse(JSON.stringify(message)))
    }
  }

  const snapshotId = `${sessionId}_${Date.now()}`
  setCompactionSnapshots((prev) => {
    const next = new Map(prev)
    const sessionSnapshots = next.get(sessionId) || new Map()
    sessionSnapshots.set(snapshotId, snapshot)
    next.set(sessionId, sessionSnapshots)

    const retentionWindow = compactionConfig().undoRetentionWindow
    if (sessionSnapshots.size > retentionWindow) {
      const keys = Array.from(sessionSnapshots.keys()).sort()
      for (let i = 0; i < keys.length - retentionWindow; i++) {
        sessionSnapshots.delete(keys[i])
      }
    }

    return next
  })

  log.info("Compaction snapshot created", { instanceId, sessionId, snapshotId, messageCount: snapshot.size })
  return snapshotId
}

export async function undoCompaction(instanceId: string, sessionId: string, eventId: string): Promise<boolean> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) {
    log.warn("Cannot undo compaction: instance not found", { instanceId, sessionId })
    return false
  }

  const sessionSnapshots = compactionSnapshots().get(sessionId)
  if (!sessionSnapshots) {
    log.warn("No snapshots found for session", { sessionId })
    return false
  }

  const compactionEvent = compactionHistory().get(sessionId)?.find((e) => e.event_id === eventId)
  if (!compactionEvent || !compactionEvent.snapshot_id) {
    log.warn("Compaction event or snapshot_id not found", { sessionId, eventId, compactionEvent })
    return false
  }

  const snapshotId = compactionEvent.snapshot_id
  const snapshot = sessionSnapshots.get(snapshotId)
  if (!snapshot) {
    log.warn("Snapshot not found", { sessionId, snapshotId })
    return false
  }

  try {
    for (const [messageId, messageData] of snapshot) {
      store.upsertMessage(messageData)
    }

    const currentHistory = compactionHistory().get(sessionId) || []
    const newHistory = currentHistory.filter((event) => event.event_id !== eventId)
    setCompactionHistory((prev) => {
      const next = new Map(prev)
      next.set(sessionId, newHistory)
      return next
    })

    setCompactionSnapshots((prev) => {
      const next = new Map(prev)
      const sessionSnapshots = next.get(sessionId)
      if (sessionSnapshots) {
        sessionSnapshots.delete(snapshotId)
      }
      return next
    })

    log.info("Compaction undone successfully", { instanceId, sessionId, eventId, snapshotId })
    return true
  } catch (error) {
    log.error("Failed to undo compaction", { instanceId, sessionId, eventId, error })
    return false
  }
}

export async function rehydrateSession(instanceId: string, sessionId: string, eventId: string): Promise<boolean> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) {
    log.warn("Cannot rehydrate session: instance not found", { instanceId, sessionId })
    return false
  }

  const sessionSnapshots = compactionSnapshots().get(sessionId)
  if (!sessionSnapshots) {
    log.warn("No snapshots found for session", { sessionId })
    return false
  }

  let targetSnapshotId: string | null = null
  for (const [snapshotId, _] of sessionSnapshots) {
    const compactionEvent = compactionHistory().get(sessionId)?.find((e) => e.event_id === eventId)
    if (compactionEvent) {
      const eventTimestamp = new Date(compactionEvent.timestamp).getTime()
      const snapshotTimestamp = parseInt(snapshotId.split("_").pop() || "0")
      if (snapshotTimestamp <= eventTimestamp) {
        targetSnapshotId = snapshotId
      }
    }
  }

  if (!targetSnapshotId) {
    targetSnapshotId = Array.from(sessionSnapshots.keys()).sort().pop() || null
  }

  if (!targetSnapshotId) {
    log.warn("No snapshot available for rehydration", { sessionId, eventId })
    return false
  }

  const snapshot = sessionSnapshots.get(targetSnapshotId)
  if (!snapshot) {
    log.warn("Snapshot not found", { sessionId, targetSnapshotId })
    return false
  }

  try {
    for (const [messageId, messageData] of snapshot) {
      store.upsertMessage(messageData)
    }

    log.info("Session rehydrated successfully", { instanceId, sessionId, eventId, targetSnapshotId })
    return true
  } catch (error) {
    log.error("Failed to rehydrate session", { instanceId, sessionId, eventId, error })
    return false
  }
}

export function getAvailableSnapshots(sessionId: string): string[] {
  const sessionSnapshots = compactionSnapshots().get(sessionId)
  if (!sessionSnapshots) return []
  return Array.from(sessionSnapshots.keys())
}

export function clearSnapshots(sessionId: string): void {
  setCompactionSnapshots((prev) => {
    const next = new Map(prev)
    next.delete(sessionId)
    return next
  })
  log.info("Snapshots cleared for session", { sessionId })
}

export function setSessionCompactionState(instanceId: string, sessionId: string, isCompacting: boolean): void {
  setSessionCompactingStates((prev) => {
    const next = new Map(prev)
    const key = `${instanceId}:${sessionId}`
    next.set(key, isCompacting)
    return next
  })
}

export function getSessionCompactionState(instanceId: string, sessionId: string): boolean {
  return sessionCompactingStates().get(`${instanceId}:${sessionId}`) || false
}

export function getCompactionHistory(sessionId: string): CompactionEvent[] {
  return compactionHistory().get(sessionId) || []
}

export function setCompactionSuggestion(instanceId: string, sessionId: string, reason: string): void {
  const key = `${instanceId}:${sessionId}`
  setCompactionSuggestions((prev) => {
    const next = new Map(prev)
    next.set(key, { reason, timestamp: Date.now() })
    return next
  })
}

export function clearCompactionSuggestion(instanceId: string, sessionId: string): void {
  const key = `${instanceId}:${sessionId}`
  setCompactionSuggestions((prev) => {
    const next = new Map(prev)
    next.delete(key)
    return next
  })
}

export function getCompactionSuggestion(instanceId: string, sessionId: string): CompactionSuggestion | null {
  return compactionSuggestions().get(`${instanceId}:${sessionId}`) ?? null
}

export function exportAuditLog(): string {
  const logEntries: string[] = []
  compactionHistory().forEach((events, sessionId) => {
    events.forEach((event) => {
      logEntries.push(JSON.stringify({ sessionId, ...event }))
    })
  })
  return logEntries.join("\n")
}

function estimateMessageTokens(message: any): number {
  let tokens = 0
  const parts = message.parts || {}

  for (const partId in parts) {
    const part = parts[partId]
    if (!part || !part.data) continue

    const data = part.data
    if (data.type === "text") {
      tokens += Math.ceil((data.text || "").length / 4)
    } else if (data.type === "tool") {
      tokens += 300
    } else if (data.type === "file") {
      tokens += 50
    } else {
      tokens += 100
    }
  }

  return tokens
}

function isSystemMessage(message: any): boolean {
  return message.role === "system" || (message.metadata?.isSystem === true)
}

function isTaskCriticalMessage(message: any): boolean {
  const parts = message.parts || {}
  for (const partId in parts) {
    const part = parts[partId]
    if (!part || !part.data) continue

    const data = part.data
    if (data.type === "text") {
      const text = (data.text || "").toLowerCase()
      return text.includes("file:") || text.includes("decision:") || text.includes("conclusion:") ||
        text.includes("summary:") || text.includes("result:") || text.includes("completed")
    }
  }
  return false
}

// Extract text content from message - needed by categorization helpers
function extractTextContent(message: any): string {
  const parts = message.parts || {}
  let text = ""

  for (const partId in parts) {
    const part = parts[partId]
    if (!part || !part.data) continue

    const data = part.data
    if (data.type === "text") {
      text += data.text + "\n"
    }
  }

  return text.trim()
}

function categorizeMessagesForCompaction(messages: any[]): { keep: any[]; compress: any[]; windowInfo: { totalMessages: number; windowStart: number; windowEnd: number } } {
  const config = compactionConfig()
  const keep: any[] = []
  const compress: any[] = []

  // ADK-style: Identify the sliding window boundaries
  const totalMessages = messages.length
  const overlapSize = config.overlapSize
  const recentToKeep = config.recentMessagesToKeep

  // Window: Keep the last N messages (overlap + recent) in full
  const windowEnd = totalMessages
  const windowStart = Math.max(0, totalMessages - recentToKeep - overlapSize)

  // Categorize messages by importance
  const systemMessages: any[] = []
  const fileOperationMessages: any[] = []
  const decisionMessages: any[] = []
  const errorMessages: any[] = []
  const recentWindowMessages: any[] = []
  const olderMessages: any[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    const isInRecentWindow = i >= windowStart

    if (isSystemMessage(message)) {
      systemMessages.push(message)
    } else if (isFileOperationMessage(message) && config.preserveFileOperations) {
      fileOperationMessages.push(message)
    } else if (isDecisionMessage(message) && config.preserveDecisions) {
      decisionMessages.push(message)
    } else if (isErrorMessage(message)) {
      errorMessages.push(message)
    } else if (isInRecentWindow) {
      recentWindowMessages.push(message)
    } else {
      olderMessages.push(message)
    }
  }

  // Keep: Recent window + system + file operations + decisions + errors
  keep.push(...systemMessages.slice(-config.systemMessagesToKeep))
  keep.push(...fileOperationMessages)  // Always preserve file context
  keep.push(...decisionMessages)        // Always preserve decisions
  keep.push(...errorMessages.slice(-3)) // Keep recent errors for debugging
  keep.push(...recentWindowMessages)    // Keep entire recent window for continuity

  // Compress: Everything else (older messages outside the window)
  const keepIds = new Set(keep.map((m) => m.id))
  for (const message of messages) {
    if (!keepIds.has(message.id)) {
      compress.push(message)
    }
  }

  const windowInfo = { totalMessages, windowStart, windowEnd }

  log.info("ADK-style message categorization for compaction", {
    total: messages.length,
    keep: keep.length,
    compress: compress.length,
    system: systemMessages.length,
    fileOperations: fileOperationMessages.length,
    decisions: decisionMessages.length,
    errors: errorMessages.length,
    recentWindow: recentWindowMessages.length,
    windowInfo,
  })

  return { keep, compress, windowInfo }
}

// Helper functions for improved message classification
function isFileOperationMessage(message: any): boolean {
  const text = extractTextContent(message).toLowerCase()
  return text.includes("file:") ||
    text.includes("created file") ||
    text.includes("modified file") ||
    text.includes("deleted file") ||
    text.includes("write_to_file") ||
    text.includes("replace_file") ||
    text.includes("mv ") ||
    text.includes("cp ") ||
    text.includes("rm ")
}

function isDecisionMessage(message: any): boolean {
  const text = extractTextContent(message).toLowerCase()
  return text.includes("decided") ||
    text.includes("going with") ||
    text.includes("chose") ||
    text.includes("decision:") ||
    text.includes("approach:") ||
    text.includes("strategy:") ||
    text.includes("will use") ||
    text.includes("implementing")
}

function isErrorMessage(message: any): boolean {
  const text = extractTextContent(message).toLowerCase()
  return text.includes("error:") ||
    text.includes("failed") ||
    text.includes("exception") ||
    text.includes("traceback") ||
    text.includes("cannot") ||
    text.includes("unable to")
}

const SMART_COMPACTION_PROMPT = `You are a Context Compression Agent. Your job is to compress conversation history while preserving essential context for continued work.

## What to Preserve:
1. **Decisions Made**: Key decisions about implementation approach, architecture, or strategy
2. **File Operations**: Files created, modified, deleted with their purposes
3. **Task Progress**: What has been completed, what's in progress, what's blocked
4. **Code Changes**: Important code snippets or patterns established
5. **Error Context**: Critical errors encountered and their resolutions
6. **User Requirements**: What the user wants to accomplish

## What to Summarize:
1. Verbose tool outputs (build logs, test results, file listings)
2. Repetitive clarification messages
3. Intermediate steps that don't affect the final outcome
4. Generic greetings and acknowledgments

## Output Format:
{
  "human_summary": "2-3 line summary",
  "what_was_done": ["action 1", "action 2"],
  "files_touched": [{"path": "...", "action": "created|modified|deleted", "reason": "..."}],
  "decisions": [{"topic": "...", "decision": "...", "rationale": "..."}],
  "current_state": "Brief description of current project state",
  "next_steps": ["step 1", "step 2"],
  "blockers": ["blocker 1"],
  "errors": [{"error": "...", "resolution": "..."}],
  "preserved_messages": ["msg_id_1", "msg_id_2"]
}

## Instructions:
- Keep the summary concise but information-dense
- Use exact file paths when mentioned
- Include reasoning for important decisions
- List message IDs that should NOT be compressed (system messages, recent exchanges)
- Redact any secrets, API keys, or sensitive information`

async function generateSmartSummary(instanceId: string, sessionId: string, messagesToCompress: any[], allMessages: any[]): Promise<{
  human_summary: string
  detailed_summary: StructuredSummary
  preservedIds: string[]
}> {
  const config = compactionConfig()
  const userMessages = messagesToCompress.filter((m) => m.role === "user").length
  const assistantMessages = messagesToCompress.filter((m) => m.role === "assistant").length

  // Extract rich context from messages
  const fileOperations = extractFileOperations(messagesToCompress)
  const decisions = extractDecisions(messagesToCompress)
  const errors = extractErrors(messagesToCompress)
  const userRequests = extractUserRequests(messagesToCompress)
  const completedTasks = extractCompletedTasks(messagesToCompress)
  const codePatterns = extractCodePatterns(messagesToCompress)

  const preservedIds = allMessages
    .filter((m) => isSystemMessage(m) || isTaskCriticalMessage(m) || isFileOperationMessage(m) || isDecisionMessage(m))
    .map((m) => m.id)

  // Build what_was_done array with rich context
  const what_was_done: string[] = []

  // Add user requests/goals
  if (userRequests.length > 0) {
    what_was_done.push(`User goals: ${userRequests.slice(0, 3).join("; ")}`)
  }

  // Add completed tasks
  if (completedTasks.length > 0) {
    what_was_done.push(...completedTasks.slice(0, 5))
  }

  // Add file operations summary
  if (fileOperations.length > 0) {
    const created = fileOperations.filter(f => f.action === "created").length
    const modified = fileOperations.filter(f => f.action === "modified").length
    const deleted = fileOperations.filter(f => f.action === "deleted").length
    what_was_done.push(`File operations: ${created} created, ${modified} modified, ${deleted} deleted`)

    // Add specific important files
    fileOperations.slice(0, 5).forEach(op => {
      what_was_done.push(`  - ${op.action}: ${op.path}${op.reason ? ` (${op.reason})` : ""}`)
    })
  }

  // Add decisions summary
  if (decisions.length > 0) {
    what_was_done.push(`Key decisions made: ${decisions.length}`)
    decisions.slice(0, 3).forEach(d => {
      what_was_done.push(`  - ${d.decision}`)
    })
  }

  // Add error resolutions
  if (errors.length > 0) {
    const resolved = errors.filter(e => e.resolution !== "Not specified").length
    what_was_done.push(`Errors encountered: ${errors.length} (${resolved} resolved)`)
  }

  // Fallback if nothing extracted
  if (what_was_done.length === 0) {
    what_was_done.push(`Compacted ${messagesToCompress.length} messages (${userMessages} user, ${assistantMessages} assistant)`)
  }

  const detailed_summary: StructuredSummary = {
    timestamp: new Date().toISOString(),
    summary_type: config.enableAiSummarization ? "tierB_detailed" : "tierA_short",
    what_was_done,
    files: fileOperations.map((op) => ({
      path: op.path,
      notes: `${op.action}${op.reason ? `: ${op.reason}` : ""}`,
      decision_id: op.reason || "",
    })),
    current_state: summarizeCurrentState(messagesToCompress),
    key_decisions: decisions,
    next_steps: extractNextSteps(messagesToCompress),
    blockers: extractBlockers(messagesToCompress),
    artifacts: codePatterns.map(p => ({ type: "code_pattern", uri: p.file || "inline", notes: p.pattern })),
    tags: ["context-compaction", "sliding-window", `msgs-${messagesToCompress.length}`],
    provenance: {
      model: config.enableAiSummarization ? "adk_compaction_v1" : "deterministic",
      token_count: 0,
      redactions: [],
    },
    aggressive: false,
  }

  // Build human-readable summary for display
  const summaryParts: string[] = []
  summaryParts.push(`📦 **Context Compaction Summary**`)
  summaryParts.push(`Compacted ${messagesToCompress.length} messages (${userMessages} user, ${assistantMessages} assistant)`)

  if (fileOperations.length > 0) {
    summaryParts.push(`\n📁 **Files touched:** ${fileOperations.length}`)
    fileOperations.slice(0, 3).forEach(op => {
      summaryParts.push(`  • ${op.action}: \`${op.path}\``)
    })
    if (fileOperations.length > 3) {
      summaryParts.push(`  ...and ${fileOperations.length - 3} more`)
    }
  }

  if (decisions.length > 0) {
    summaryParts.push(`\n🎯 **Key decisions:** ${decisions.length}`)
    decisions.slice(0, 2).forEach(d => {
      summaryParts.push(`  • ${d.decision}`)
    })
  }

  if (userRequests.length > 0) {
    summaryParts.push(`\n💬 **User goals:** ${userRequests.slice(0, 2).join("; ")}`)
  }

  const human_summary = summaryParts.join("\n")

  log.info("ADK-style smart summary generated", {
    sessionId,
    messagesCompressed: messagesToCompress.length,
    filesPreserved: fileOperations.length,
    decisionsPreserved: decisions.length,
    userRequests: userRequests.length,
    completedTasks: completedTasks.length,
  })

  return { human_summary, detailed_summary, preservedIds }
}

// Extract user requests/goals from messages
function extractUserRequests(messages: any[]): string[] {
  const requests: string[] = []

  for (const message of messages) {
    if (message.role !== "user") continue
    const text = extractTextContent(message)

    // Get first sentence or first 100 chars as the request
    const firstSentence = text.split(/[.!?\n]/)[0]?.trim()
    if (firstSentence && firstSentence.length > 10 && firstSentence.length < 200) {
      requests.push(firstSentence)
    }
  }

  // Deduplicate similar requests
  return [...new Set(requests)].slice(0, 5)
}

// Extract completed task descriptions
function extractCompletedTasks(messages: any[]): string[] {
  const tasks: string[] = []

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const text = extractTextContent(message).toLowerCase()

    const completionPatterns = [
      /(?:i've|i have|successfully|completed|done|finished)\s+(.+?)(?:\.|$)/gi,
      /(?:created|added|implemented|fixed|updated)\s+(.+?)(?:\.|$)/gi,
    ]

    for (const pattern of completionPatterns) {
      const match = pattern.exec(text)
      if (match && match[1]) {
        const task = match[1].trim()
        if (task.length > 10 && task.length < 150) {
          tasks.push(task)
        }
      }
    }
  }

  return [...new Set(tasks)].slice(0, 10)
}

// Extract code patterns established
function extractCodePatterns(messages: any[]): Array<{ pattern: string; file?: string }> {
  const patterns: Array<{ pattern: string; file?: string }> = []

  for (const message of messages) {
    const text = extractTextContent(message)

    // Look for pattern/approach mentions
    const patternMatch = text.match(/(?:pattern|approach|using|implementing)\s*:\s*(.+?)(?:\n|$)/gi)
    if (patternMatch) {
      patternMatch.forEach(match => {
        const pattern = match.replace(/(?:pattern|approach|using|implementing)\s*:\s*/i, "").trim()
        if (pattern.length > 5 && pattern.length < 100) {
          patterns.push({ pattern })
        }
      })
    }
  }

  return patterns.slice(0, 5)
}

function extractFileOperations(messages: any[]): Array<{ path: string; action: string; reason: string }> {
  const operations: Array<{ path: string; action: string; reason: string }> = []

  for (const message of messages) {
    const text = extractTextContent(message).toLowerCase()

    const fileMatch = text.match(/file:\s*([^\s\n]+)/gi)
    if (fileMatch) {
      for (const match of fileMatch) {
        const path = match.replace(/file:\s*/i, "").trim()
        let action = "modified"
        if (text.includes("created") || text.includes("new file")) action = "created"
        if (text.includes("deleted") || text.includes("removed")) action = "deleted"

        operations.push({ path, action, reason: "File operation detected in message" })
      }
    }
  }

  return operations
}

function extractDecisions(messages: any[]): Array<{ id: string; decision: string; rationale: string; actor: "agent" | "user" }> {
  const decisions: Array<{ id: string; decision: string; rationale: string; actor: "agent" | "user" }> = []
  let decisionId = 0

  for (const message of messages) {
    const text = extractTextContent(message).toLowerCase()

    const decisionPatterns = [
      /decided\s+(to|on|that)\s+(.+?)(?:\.|$)/gi,
      /going\s+with\s+(.+?)(?:\.|$)/gi,
      /chose\s+(.+?)(?:\.|$)/gi,
      /using\s+(.+?)(?:approach|pattern|method)(?:\.|$)/gi,
    ]

    for (const pattern of decisionPatterns) {
      const match = pattern.exec(text)
      if (match) {
        decisionId++
        decisions.push({
          id: `dec_${decisionId}`,
          decision: match[2].trim(),
          rationale: "Extracted from conversation context",
          actor: message.role === "user" ? "user" : "agent",
        })
      }
    }
  }

  return decisions
}

function extractErrors(messages: any[]): Array<{ error: string; resolution: string }> {
  const errors: Array<{ error: string; resolution: string }> = []

  for (const message of messages) {
    const text = extractTextContent(message)

    const errorMatch = text.match(/error:\s*(.+?)(?:\n|$)/gi)
    if (errorMatch) {
      for (const match of errorMatch) {
        const errorText = match.replace(/error:\s*/i, "").trim()
        let resolution = "Not specified"

        if (text.toLowerCase().includes("fixed") || text.toLowerCase().includes("resolved")) {
          resolution = "Fixed in subsequent messages"
        }

        errors.push({ error: errorText, resolution })
      }
    }
  }

  return errors
}

function summarizeCurrentState(messages: any[]): string {
  const lastMessage = messages[messages.length - 1]
  const text = extractTextContent(lastMessage)

  if (text.length > 200) {
    return text.substring(0, 200) + "..."
  }

  return text || "Session in progress"
}

function extractNextSteps(messages: any[]): string[] {
  const steps: string[] = []

  for (const message of messages) {
    const text = extractTextContent(message).toLowerCase()

    const nextPatterns = [
      /next\s+(?:step|steps?)[:\s]+(.+?)(?:\.|$)/gi,
      /will\s+(?:now|next)\s+(.+?)(?:\.|$)/gi,
      /todo[:\s]+(.+?)(?:\.|$)/gi,
    ]

    for (const pattern of nextPatterns) {
      const match = pattern.exec(text)
      if (match) {
        steps.push(match[1].trim())
      }
    }
  }

  return steps.slice(0, 5)
}

function extractBlockers(messages: any[]): string[] {
  const blockers: string[] = []

  for (const message of messages) {
    const text = extractTextContent(message).toLowerCase()

    const blockerPatterns = [
      /blocked\s+(?:by|on)[:\s]+(.+?)(?:\.|$)/gi,
      /waiting\s+for[:\s]+(.+?)(?:\.|$)/gi,
      /cannot\s+(?:proceed|continue)[:\s]+(.+?)(?:\.|$)/gi,
    ]

    for (const pattern of blockerPatterns) {
      const match = pattern.exec(text)
      if (match) {
        blockers.push(match[1].trim())
      }
    }
  }

  return blockers
}

async function executeSmartCompaction(instanceId: string, sessionId: string): Promise<CompactionResult> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) {
    return {
      success: false,
      mode: "compact",
      human_summary: "Instance not found",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const messageIds = store.getSessionMessageIds(sessionId)
  const messages = messageIds.map((id) => store.getMessage(id)).filter((m) => m != null) as any[]

  if (messages.length <= 5) {
    return {
      success: true,
      mode: "compact",
      human_summary: "Session too small to compact",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const usage = store.getSessionUsage(sessionId)
  const tokenBefore = (usage?.totalInputTokens || 0) + (usage?.totalOutputTokens || 0) + (usage?.totalReasoningTokens || 0)

  log.info("Executing smart compaction", { instanceId, sessionId, messageCount: messages.length, tokenBefore })

  try {
    const snapshotId = await createCompactionSnapshot(instanceId, sessionId)

    const { keep, compress, windowInfo } = categorizeMessagesForCompaction(messages)

    if (compress.length === 0) {
      log.info("No messages to compress after categorization", { sessionId })
      return {
        success: true,
        mode: "compact",
        human_summary: "Session already optimized - no messages to compress",
        token_before: tokenBefore,
        token_after: tokenBefore,
        token_reduction_pct: 0,
      }
    }

    const { human_summary, detailed_summary, preservedIds } = await generateSmartSummary(instanceId, sessionId, compress, messages)

    let totalRedactions = 0
    for (const msg of compress) {
      const content = extractTextContent(msg)
      const redacted = redactSecrets(content, `session:${sessionId}`)
      if (redacted.redactions.length > 0) {
        totalRedactions += redacted.redactions.length
      }
    }

    const summaryPartId = `summary_part_${Date.now()}`
    const messageId = `summary_${Date.now()}`

    // Create a proper text part that matches ClientPart format
    const summaryPart = {
      id: summaryPartId,
      type: "text" as const,
      text: human_summary,
      time: { start: Date.now(), end: Date.now() },
      sessionID: sessionId,
      messageID: messageId,
    }

    const summaryMessage = {
      id: messageId,
      sessionId,
      role: "assistant" as const,
      status: "complete" as const,
      parts: [summaryPart],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bumpRevision: true,
    }

    log.info("Creating compaction summary message", {
      messageId,
      summaryLength: human_summary.length,
      compressedCount: compress.length
    })

    store.upsertMessage(summaryMessage)

    for (const message of compress) {
      const updatedMessage = { ...message, archived: true, archiveReason: "compacted" }
      store.upsertMessage(updatedMessage)
    }

    const tokenAfter = Math.round(tokenBefore * (1 - (compress.length / messages.length) * 0.7))

    const compactionEvent: CompactionEvent = {
      event_id: `comp_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "auto",
      trigger_reason: "overflow",
      token_before: tokenBefore,
      token_after: tokenAfter,
      model_used: "smart_compaction_v2",
      cost_estimate: 0,
      snapshot_id: snapshotId,
    }

    const eventValidation = validateCompactionEvent(compactionEvent)
    if (!eventValidation.success) {
      log.error("Compaction event validation failed", { errors: eventValidation.errors })
      throw new Error(`Invalid compaction event: ${eventValidation.errors.join(", ")}`)
    }

    if (totalRedactions > 0) {
      log.info("Secrets redacted during compaction", { sessionId, totalRedactions })
    }

    await recordCompactionEvent(sessionId, compactionEvent)

    log.info("Smart compaction completed", {
      sessionId,
      messagesCompacted: compress.length,
      messagesPreserved: keep.length,
      tokenReduction: estimateTokenReduction(tokenBefore, tokenAfter),
    })

    return {
      success: true,
      mode: "compact",
      human_summary,
      detailed_summary,
      token_before: tokenBefore,
      token_after: tokenAfter,
      token_reduction_pct: estimateTokenReduction(tokenBefore, tokenAfter),
      compaction_event: compactionEvent,
    }
  } catch (error) {
    log.error("Smart compaction failed", { instanceId, sessionId, error })
    return {
      success: false,
      mode: "compact",
      human_summary: "Compaction failed",
      token_before: tokenBefore,
      token_after: tokenBefore,
      token_reduction_pct: 0,
    }
  }
}

async function executePruneCompaction(instanceId: string, sessionId: string): Promise<CompactionResult> {
  const store = messageStoreBus.getInstance(instanceId)
  if (!store) {
    return {
      success: false,
      mode: "prune",
      human_summary: "Instance not found",
      token_before: 0,
      token_after: 0,
      token_reduction_pct: 0,
    }
  }

  const messageIds = store.getSessionMessageIds(sessionId)
  const usage = store.getSessionUsage(sessionId)

  const tokenBefore = (usage?.totalInputTokens || 0) + (usage?.totalOutputTokens || 0) + (usage?.totalReasoningTokens || 0)

  log.info("Executing prune compaction", { instanceId, sessionId, messageCount: messageIds.length, tokenBefore })

  try {
    const snapshotId = await createCompactionSnapshot(instanceId, sessionId)

    let reclaimedTokens = 0
    const prunedPartIds: string[] = []

    for (const messageId of messageIds) {
      const message = store.getMessage(messageId)
      if (!message) continue

      const parts = message.parts || {}
      for (const partId in parts) {
        const part = parts[partId]
        if (!part || !part.data) continue

        if (isToolOutput(part) && reclaimedTokens < compactionConfig().pruneReclaimThreshold) {
          reclaimedTokens += estimatePartTokens(part)
        } else if (isToolOutput(part)) {
          prunedPartIds.push(partId)
        }
      }

      if (reclaimedTokens > compactionConfig().pruneReclaimThreshold) {
        break
      }
    }

    for (const messageId of messageIds) {
      const message = store.getMessage(messageId)
      if (!message) continue

      const parts = message.parts || {}
      for (const partId in parts) {
        const part = parts[partId]
        if (!part || !part.data) continue

        if (prunedPartIds.includes(partId)) {
          const textContent = "[Tool output pruned to save tokens]"
          part.data = { id: partId, type: "text", text: textContent, sessionID: sessionId, messageID: messageId }
        }
      }
    }

    const human_summary = `Pruned ${prunedPartIds.length} old tool outputs, reclaimed ~${reclaimedTokens} tokens`

    const compactionEvent: CompactionEvent = {
      event_id: `prune_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "auto",
      trigger_reason: "manual",
      token_before: tokenBefore,
      token_after: tokenBefore - reclaimedTokens,
      model_used: "prune_agent_v1",
      cost_estimate: 0,
      snapshot_id: snapshotId,
    }

    await recordCompactionEvent(sessionId, compactionEvent)

    return {
      success: true,
      mode: "prune",
      human_summary,
      token_before: tokenBefore,
      token_after: tokenBefore - reclaimedTokens,
      token_reduction_pct: estimateTokenReduction(tokenBefore, tokenBefore - reclaimedTokens),
      compaction_event: compactionEvent,
    }
  } catch (error) {
    log.error("Prune compaction failed", { instanceId, sessionId, error })
    return {
      success: false,
      mode: "prune",
      human_summary: "Prune failed",
      token_before: tokenBefore,
      token_after: tokenBefore,
      token_reduction_pct: 0,
    }
  }
}

function isToolOutput(part: any): boolean {
  if (!part || !part.data) return false
  const data = part.data

  if (data.type === "tool") {
    return true
  }

  if (data.type === "text") {
    const text = (data.text || "").toLowerCase()
    return text.includes("building") || text.includes("compiling") || text.includes("test") ||
      text.includes("error") || text.includes("warning") || text.length > 1000
  }

  return false
}

function estimatePartTokens(part: any): number {
  if (!part || !part.data) return 0
  const data = part.data

  if (data.type === "text") {
    return Math.ceil((data.text || "").length / 4)
  }

  if (data.type === "tool") {
    return 500
  }

  return 100
}

function taskCriticalMessage(message: any): boolean {
  const parts = message.parts || {}
  for (const partId in parts) {
    const part = parts[partId]
    if (!part || !part.data) continue

    const data = part.data
    if (data.type === "text") {
      const text = (data.text || "").toLowerCase()
      return text.includes("file:") || text.includes("decision:") || text.includes("conclusion:") ||
        text.includes("summary:") || text.includes("result:") || text.includes("completed") ||
        text.includes("decided") || text.includes("going with") || text.includes("chose")
    }
  }
  return false
}

async function executeCompaction(instanceId: string, sessionId: string, mode: "prune" | "compact"): Promise<CompactionResult> {
  if (mode === "compact") {
    return executeSmartCompaction(instanceId, sessionId)
  }
  return executePruneCompaction(instanceId, sessionId)
}

export async function checkAndTriggerAutoCompact(instanceId: string, sessionId: string): Promise<boolean> {
  const config = compactionConfig()
  if (!config.autoCompactEnabled || config.userPreference === "never") {
    return false
  }

  const store = messageStoreBus.getInstance(instanceId)
  if (!store) return false

  const usage = store.getSessionUsage(sessionId)
  if (!usage) return false

  const instance = (window as any).instances?.get?.(instanceId)
  const modelLimit = instance?.model?.contextLimit || 128000

  if (!isOverflowDetected(usage, modelLimit)) {
    return false
  }

  if (shouldPruneToolOutputs(usage)) {
    log.info("Auto-compact suggested (tool output overflow)", { instanceId, sessionId, usage })
    return true
  }

  if (config.userPreference === "auto" || config.userPreference === "ask") {
    log.info("Auto-compact suggested (overflow)", { instanceId, sessionId, usage })
    return true
  }

  return false
}

export async function executeCompactionWrapper(instanceId: string, sessionId: string, mode: "prune" | "compact" = "compact"): Promise<CompactionResult> {
  return await executeCompaction(instanceId, sessionId, mode)
}
