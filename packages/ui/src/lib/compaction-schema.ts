import { z } from "zod"
import { getLogger } from "./logger.js"

const log = getLogger("compaction-schema")

export const SecretRedactionSchema = z.object({
  path: z.string(),
  reason: z.string(),
})

export const ProvenanceSchema = z.object({
  model: z.string().min(1, "Model name is required"),
  token_count: z.number().int().nonnegative(),
  redactions: z.array(SecretRedactionSchema),
})

export const KeyDecisionSchema = z.object({
  id: z.string().min(1, "Decision ID is required"),
  decision: z.string().min(1, "Decision is required"),
  rationale: z.string().min(1, "Rationale is required"),
  actor: z.enum(["agent", "user"], { errorMap: () => ({ message: "Actor must be 'agent' or 'user'" }) }),
})

export const ArtifactSchema = z.object({
  type: z.string().min(1, "Artifact type is required"),
  uri: z.string().min(1, "Artifact URI is required"),
  notes: z.string(),
})

export const FileReferenceSchema = z.object({
  path: z.string().min(1, "File path is required"),
  notes: z.string(),
  decision_id: z.string().min(1, "Decision ID is required"),
})

export const StructuredSummarySchema = z.object({
  timestamp: z.string().datetime(),
  summary_type: z.enum(["tierA_short", "tierB_detailed"]),
  what_was_done: z.array(z.string()).min(1, "At least one 'what_was_done' entry is required"),
  files: z.array(FileReferenceSchema).optional(),
  current_state: z.string().min(1, "Current state is required"),
  key_decisions: z.array(KeyDecisionSchema).optional(),
  next_steps: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  artifacts: z.array(ArtifactSchema).optional(),
  tags: z.array(z.string()).optional(),
  provenance: ProvenanceSchema,
  aggressive: z.boolean(),
})

export const CompactionEventSchema = z.object({
  event_id: z.string().min(1, "Event ID is required"),
  timestamp: z.string().datetime(),
  actor: z.enum(["user", "auto"], { errorMap: () => ({ message: "Actor must be 'user' or 'auto'" }) }),
  trigger_reason: z.enum(["overflow", "scheduled", "manual"]),
  token_before: z.number().int().nonnegative(),
  token_after: z.number().int().nonnegative(),
  model_used: z.string().min(1, "Model name is required"),
  cost_estimate: z.number().nonnegative(),
  snapshot_id: z.string().optional(),
})

export const CompactionConfigSchema = z.object({
  autoCompactEnabled: z.boolean(),
  autoCompactThreshold: z.number().int().min(1).max(100),
  compactPreserveWindow: z.number().int().positive(),
  pruneReclaimThreshold: z.number().int().positive(),
  userPreference: z.enum(["auto", "ask", "never"]),
  undoRetentionWindow: z.number().int().positive(),
  recentMessagesToKeep: z.number().int().positive().optional(),
  systemMessagesToKeep: z.number().int().positive().optional(),
  incrementalChunkSize: z.number().int().positive().optional(),
  // ADK-style sliding window settings
  compactionInterval: z.number().int().positive().optional(),
  overlapSize: z.number().int().nonnegative().optional(),
  enableAiSummarization: z.boolean().optional(),
  summaryMaxTokens: z.number().int().positive().optional(),
  preserveFileOperations: z.boolean().optional(),
  preserveDecisions: z.boolean().optional(),
})

export const CompactionResultSchema = z.object({
  success: z.boolean(),
  mode: z.enum(["prune", "compact"]),
  human_summary: z.string().min(1, "Human summary is required"),
  detailed_summary: StructuredSummarySchema.optional(),
  token_before: z.number().int().nonnegative(),
  token_after: z.number().int().nonnegative(),
  token_reduction_pct: z.number().int().min(0).max(100),
  compaction_event: CompactionEventSchema.optional(),
  preview: z.string().optional(),
})

export type SecretRedaction = z.infer<typeof SecretRedactionSchema>
export type Provenance = z.infer<typeof ProvenanceSchema>
export type KeyDecision = z.infer<typeof KeyDecisionSchema>
export type Artifact = z.infer<typeof ArtifactSchema>
export type FileReference = z.infer<typeof FileReferenceSchema>
export type StructuredSummary = z.infer<typeof StructuredSummarySchema>
export type CompactionEvent = z.infer<typeof CompactionEventSchema>
export type CompactionConfig = z.infer<typeof CompactionConfigSchema>
export type CompactionResult = z.infer<typeof CompactionResultSchema>

export function validateStructuredSummary(data: unknown): { success: true; data: StructuredSummary } | { success: false; errors: string[] } {
  const result = StructuredSummarySchema.safeParse(data)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
    return { success: false, errors }
  }
  return { success: true, data: result.data }
}

export function validateCompactionEvent(data: unknown): { success: true; data: CompactionEvent } | { success: false; errors: string[] } {
  const result = CompactionEventSchema.safeParse(data)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
    return { success: false, errors }
  }
  return { success: true, data: result.data }
}

export function validateCompactionResult(data: unknown): { success: true; data: CompactionResult } | { success: false; errors: string[] } {
  const result = CompactionResultSchema.safeParse(data)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
    return { success: false, errors }
  }
  return { success: true, data: result.data }
}

export function validateCompactionConfig(data: unknown): { success: true; data: CompactionConfig } | { success: false; errors: string[] } {
  const result = CompactionConfigSchema.safeParse(data)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
    return { success: false, errors }
  }
  return { success: true, data: result.data }
}

export function sanitizeStructuredSummary(input: unknown): StructuredSummary | null {
  const result = validateStructuredSummary(input)
  if (!result.success) {
    log.warn("Invalid structured summary, using fallback", { errors: result.errors })
    return null
  }
  return result.data
}

export function createDefaultStructuredSummary(aggressive: boolean = false): StructuredSummary {
  return {
    timestamp: new Date().toISOString(),
    summary_type: "tierA_short",
    what_was_done: ["Session compaction completed"],
    files: [],
    current_state: "Session context has been compacted",
    key_decisions: [],
    next_steps: [],
    blockers: [],
    artifacts: [],
    tags: [],
    provenance: {
      model: "system",
      token_count: 0,
      redactions: [],
    },
    aggressive,
  }
}
