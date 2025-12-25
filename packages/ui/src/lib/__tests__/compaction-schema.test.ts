import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  validateStructuredSummary,
  validateCompactionEvent,
  validateCompactionResult,
  sanitizeStructuredSummary,
  type StructuredSummary,
  type CompactionEvent,
  type CompactionResult,
} from "../compaction-schema.js"

describe("compaction schema", () => {
  describe("validateStructuredSummary", () => {
    it("validates tierA summary", () => {
      const summary: StructuredSummary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short",
        what_was_done: ["Created API endpoint", "Added error handling"],
        files: [{ path: "src/api.ts", notes: "API endpoint file", decision_id: "decision-1" }],
        current_state: "API endpoint implemented with error handling",
        key_decisions: [],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(result.success)
      assert.equal(result.data.summary_type, "tierA_short")
    })

    it("validates tierB summary", () => {
      const summary: StructuredSummary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierB_detailed",
        what_was_done: ["Created API endpoint", "Added error handling", "Wrote unit tests"],
        files: [
          { path: "src/api.ts", notes: "API endpoint file", decision_id: "decision-1" },
          { path: "src/api.test.ts", notes: "Test file", decision_id: "decision-2" },
        ],
        current_state: "API endpoint implemented with error handling and full test coverage",
        key_decisions: [
          {
            id: "decision-1",
            decision: "Use Fastify for performance",
            rationale: "Fastify provides better performance than Express",
            actor: "agent",
          },
        ],
        next_steps: ["Add authentication", "Implement rate limiting"],
        blockers: [],
        artifacts: [],
        tags: ["api", "fastify"],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1500,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(result.success)
      assert.equal(result.data.summary_type, "tierB_detailed")
      assert.ok(result.data.key_decisions)
      assert.equal(result.data.key_decisions.length, 1)
    })

    it("rejects invalid timestamp", () => {
      const summary = {
        timestamp: "invalid-date",
        summary_type: "tierA_short" as const,
        what_was_done: ["Created API endpoint"],
        files: [],
        current_state: "API endpoint implemented",
        key_decisions: [],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(!result.success)
      assert.ok(result.errors.length > 0)
    })

    it("rejects empty what_was_done array", () => {
      const summary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short" as const,
        what_was_done: [],
        files: [],
        current_state: "API endpoint implemented",
        key_decisions: [],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(!result.success)
      assert.ok(result.errors.some((e) => e.includes("what_was_done")))
    })

    it("rejects empty current_state", () => {
      const summary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short" as const,
        what_was_done: ["Created API endpoint"],
        files: [],
        current_state: "",
        key_decisions: [],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(!result.success)
      assert.ok(result.errors.some((e) => e.includes("current_state")))
    })

    it("rejects invalid actor in key_decisions", () => {
      const summary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short" as const,
        what_was_done: ["Created API endpoint"],
        files: [],
        current_state: "API endpoint implemented",
        key_decisions: [
          {
            id: "decision-1",
            decision: "Use Fastify",
            rationale: "Performance",
            actor: "invalid" as any,
          },
        ],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const result = validateStructuredSummary(summary)
      assert.ok(!result.success)
    })
  })

  describe("validateCompactionEvent", () => {
    it("validates user-triggered compaction", () => {
      const event: CompactionEvent = {
        event_id: "comp_1234567890",
        timestamp: new Date().toISOString(),
        actor: "user",
        trigger_reason: "manual",
        token_before: 10000,
        token_after: 3000,
        model_used: "claude-3.5-sonnet",
        cost_estimate: 0.05,
      }
      const result = validateCompactionEvent(event)
      assert.ok(result.success)
      assert.equal(result.data.actor, "user")
    })

    it("validates auto-triggered compaction", () => {
      const event: CompactionEvent = {
        event_id: "auto_1234567890",
        timestamp: new Date().toISOString(),
        actor: "auto",
        trigger_reason: "overflow",
        token_before: 15000,
        token_after: 5000,
        model_used: "claude-3.5-sonnet",
        cost_estimate: 0.07,
      }
      const result = validateCompactionEvent(event)
      assert.ok(result.success)
      assert.equal(result.data.actor, "auto")
      assert.equal(result.data.trigger_reason, "overflow")
    })

    it("rejects negative token values", () => {
      const event = {
        event_id: "comp_1234567890",
        timestamp: new Date().toISOString(),
        actor: "user" as const,
        trigger_reason: "manual" as const,
        token_before: -1000,
        token_after: 3000,
        model_used: "claude-3.5-sonnet",
        cost_estimate: 0.05,
      }
      const result = validateCompactionEvent(event)
      assert.ok(!result.success)
    })

    it("rejects empty event_id", () => {
      const event = {
        event_id: "",
        timestamp: new Date().toISOString(),
        actor: "user" as const,
        trigger_reason: "manual" as const,
        token_before: 10000,
        token_after: 3000,
        model_used: "claude-3.5-sonnet",
        cost_estimate: 0.05,
      }
      const result = validateCompactionEvent(event)
      assert.ok(!result.success)
    })

    it("rejects invalid actor", () => {
      const event = {
        event_id: "comp_1234567890",
        timestamp: new Date().toISOString(),
        actor: "invalid" as any,
        trigger_reason: "manual" as const,
        token_before: 10000,
        token_after: 3000,
        model_used: "claude-3.5-sonnet",
        cost_estimate: 0.05,
      }
      const result = validateCompactionEvent(event)
      assert.ok(!result.success)
    })
  })

  describe("validateCompactionResult", () => {
    it("validates successful compaction", () => {
      const result: CompactionResult = {
        success: true,
        mode: "compact",
        human_summary: "Compacted 100 messages",
        detailed_summary: {
          timestamp: new Date().toISOString(),
          summary_type: "tierA_short",
          what_was_done: ["Compacted 100 messages"],
          files: [],
          current_state: "Session compacted",
          key_decisions: [],
          next_steps: [],
          blockers: [],
          artifacts: [],
          tags: [],
          provenance: {
            model: "claude-3.5-sonnet",
            token_count: 1000,
            redactions: [],
          },
          aggressive: false,
        },
        token_before: 10000,
        token_after: 3000,
        token_reduction_pct: 70,
      }
      const validation = validateCompactionResult(result)
      assert.ok(validation.success)
    })

    it("validates failed compaction", () => {
      const result: CompactionResult = {
        success: false,
        mode: "compact",
        human_summary: "Compaction failed",
        token_before: 10000,
        token_after: 10000,
        token_reduction_pct: 0,
      }
      const validation = validateCompactionResult(result)
      assert.ok(validation.success)
      assert.equal(validation.data.success, false)
    })

    it("rejects invalid token reduction percentage", () => {
      const result = {
        success: true,
        mode: "compact" as const,
        human_summary: "Compacted 100 messages",
        token_before: 10000,
        token_after: 3000,
        token_reduction_pct: 150,
      }
      const validation = validateCompactionResult(result)
      assert.ok(!validation.success)
    })

    it("rejects negative token reduction percentage", () => {
      const result = {
        success: true,
        mode: "compact" as const,
        human_summary: "Compacted 100 messages",
        token_before: 10000,
        token_after: 3000,
        token_reduction_pct: -10,
      }
      const validation = validateCompactionResult(result)
      assert.ok(!validation.success)
    })
  })

  describe("sanitizeStructuredSummary", () => {
    it("sanitizes summary by removing extra fields", () => {
      const dirtySummary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short" as const,
        what_was_done: ["Created API endpoint"],
        files: [],
        current_state: "API endpoint implemented",
        key_decisions: [],
        next_steps: [],
        blockers: [],
        artifacts: [],
        tags: [],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
        extraField: "should be removed",
        anotherExtra: { nested: "data" },
      }
      const clean = sanitizeStructuredSummary(dirtySummary)
      assert.ok(clean)
      assert.ok(!("extraField" in clean))
      assert.ok(!("anotherExtra" in clean))
      assert.equal(clean?.summary_type, "tierA_short")
    })

    it("preserves all valid fields", () => {
      const summary: StructuredSummary = {
        timestamp: new Date().toISOString(),
        summary_type: "tierA_short",
        what_was_done: ["Created API endpoint"],
        files: [{ path: "src/api.ts", notes: "API endpoint file", decision_id: "decision-1" }],
        current_state: "API endpoint implemented",
        key_decisions: [],
        next_steps: ["Add tests"],
        blockers: [],
        artifacts: [],
        tags: ["api"],
        provenance: {
          model: "claude-3.5-sonnet",
          token_count: 1000,
          redactions: [],
        },
        aggressive: false,
      }
      const clean = sanitizeStructuredSummary(summary)
      assert.ok(clean)
      assert.equal(clean?.what_was_done.length, 1)
      assert.ok(clean?.files)
      assert.equal(clean.files.length, 1)
      assert.ok(clean?.next_steps)
      assert.equal(clean.next_steps.length, 1)
      assert.ok(clean?.tags)
      assert.equal(clean.tags.length, 1)
    })
  })
})
