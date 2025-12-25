import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"
import type { CompactionResult } from "../session-compaction.js"
import {
  getCompactionConfig,
  updateCompactionConfig,
  undoCompaction,
  rehydrateSession,
  checkAndTriggerAutoCompact,
  setSessionCompactionState,
  getSessionCompactionState,
  estimateTokenReduction,
  executeCompactionWrapper,
} from "../session-compaction.js"
import type { CompactionEvent, StructuredSummary } from "../../lib/compaction-schema.js"

const MOCK_INSTANCE_ID = "test-instance-123"
const MOCK_SESSION_ID = "test-session-456"
const MOCK_MESSAGE_ID = "msg-789"

function createMockMessage(id: string, content: string = "Test message"): any {
  return {
    id,
    sessionId: MOCK_SESSION_ID,
    role: "user",
    content,
    status: "complete",
    parts: [{ id: `part-${id}`, type: "text", text: content, sessionID: MOCK_SESSION_ID, messageID: id }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function createMockUsage(tokens: number = 10000): any {
  return {
    totalInputTokens: Math.floor(tokens * 0.7),
    totalOutputTokens: Math.floor(tokens * 0.2),
    totalReasoningTokens: Math.floor(tokens * 0.1),
  }
}

describe("session compaction", () => {
  beforeEach(() => {
    updateCompactionConfig({
      autoCompactEnabled: true,
      autoCompactThreshold: 90,
      compactPreserveWindow: 5000,
      pruneReclaimThreshold: 10000,
      userPreference: "auto",
      undoRetentionWindow: 5,
    })
  })

  describe("getCompactionConfig", () => {
    it("returns default config", () => {
      const config = getCompactionConfig()
      assert.equal(typeof config.autoCompactEnabled, "boolean")
      assert.equal(typeof config.autoCompactThreshold, "number")
      assert.equal(typeof config.compactPreserveWindow, "number")
      assert.equal(typeof config.pruneReclaimThreshold, "number")
      assert.equal(typeof config.userPreference, "string")
      assert.equal(typeof config.undoRetentionWindow, "number")
    })

    it("allows config updates", () => {
      updateCompactionConfig({
        autoCompactEnabled: false,
        autoCompactThreshold: 80,
        compactPreserveWindow: 4000,
        pruneReclaimThreshold: 8000,
        userPreference: "ask",
        undoRetentionWindow: 10,
      })
      const config = getCompactionConfig()
      assert.equal(config.autoCompactEnabled, false)
      assert.equal(config.autoCompactThreshold, 80)
      assert.equal(config.userPreference, "ask")
      assert.equal(config.undoRetentionWindow, 10)
    })
  })

  describe("setSessionCompactionState and getSessionCompactionState", () => {
    it("tracks compaction state for sessions", () => {
      setSessionCompactionState(MOCK_INSTANCE_ID, MOCK_SESSION_ID, true)
      const isCompacting = getSessionCompactionState(MOCK_INSTANCE_ID, MOCK_SESSION_ID)
      assert.ok(isCompacting)
    })

    it("returns undefined for unknown sessions", () => {
      const isCompacting = getSessionCompactionState("unknown-instance", "unknown-session")
      assert.equal(isCompacting, undefined)
    })

    it("clears compaction state", () => {
      setSessionCompactionState(MOCK_INSTANCE_ID, MOCK_SESSION_ID, true)
      setSessionCompactionState(MOCK_INSTANCE_ID, MOCK_SESSION_ID, false)
      const isCompacting = getSessionCompactionState(MOCK_INSTANCE_ID, MOCK_SESSION_ID)
      assert.ok(!isCompacting)
    })
  })

  describe("estimateTokenReduction", () => {
    it("calculates correct percentage reduction", () => {
      const reduction = estimateTokenReduction(10000, 3000)
      assert.equal(reduction, 70)
    })

    it("returns 0 when no reduction", () => {
      const reduction = estimateTokenReduction(10000, 10000)
      assert.equal(reduction, 0)
    })

    it("handles zero tokens", () => {
      const reduction = estimateTokenReduction(0, 0)
      assert.equal(reduction, 0)
    })

    it("caps at 100%", () => {
      const reduction = estimateTokenReduction(10000, -5000)
      assert.equal(reduction, 100)
    })

    it("handles small values", () => {
      const reduction = estimateTokenReduction(100, 50)
      assert.equal(reduction, 50)
    })
  })

  describe("executeCompactionWrapper", () => {
    it("compacts session successfully", async () => {
      const mockStore = {
        getSessionMessageIds: () => [MOCK_MESSAGE_ID],
        getSessionUsage: () => createMockUsage(10000),
        getMessage: (id: string) => createMockMessage(id, "Test content"),
        upsertMessage: () => {},
        setMessageInfo: () => {},
      }

      const getInstanceMock = mock.fn(() => mockStore)
      const originalBus = (globalThis as any).messageStoreBus
      ;(globalThis as any).messageStoreBus = { getInstance: getInstanceMock }

      const result = await executeCompactionWrapper(MOCK_INSTANCE_ID, MOCK_SESSION_ID, "compact")

      assert.ok(result.success)
      assert.equal(result.mode, "compact")
      assert.ok(result.token_before > 0)
      assert.ok(result.token_after >= 0)
      assert.ok(result.token_reduction_pct >= 0)
      assert.ok(result.human_summary.length > 0)

      getInstanceMock.mock.restore()
      if (originalBus) {
        ;(globalThis as any).messageStoreBus = originalBus
      } else {
        delete (globalThis as any).messageStoreBus
      }
    })

    it("handles missing instance", async () => {
      const getInstanceMock = mock.fn(() => null)
      const originalBus = (globalThis as any).messageStoreBus
      ;(globalThis as any).messageStoreBus = { getInstance: getInstanceMock }

      const result = await executeCompactionWrapper(MOCK_INSTANCE_ID, MOCK_SESSION_ID, "compact")

      assert.ok(!result.success)
      assert.equal(result.human_summary, "Instance not found")

      getInstanceMock.mock.restore()
      if (originalBus) {
        ;(globalThis as any).messageStoreBus = originalBus
      } else {
        delete (globalThis as any).messageStoreBus
      }
    })

    it("handles prune mode", async () => {
      const mockStore = {
        getSessionMessageIds: () => [MOCK_MESSAGE_ID],
        getSessionUsage: () => createMockUsage(10000),
        getMessage: (id: string) => createMockMessage(id, "Test content"),
        upsertMessage: () => {},
        setMessageInfo: () => {},
      }

      const getInstanceMock = mock.fn(() => mockStore)
      const originalBus = (globalThis as any).messageStoreBus
      ;(globalThis as any).messageStoreBus = { getInstance: getInstanceMock }

      const result = await executeCompactionWrapper(MOCK_INSTANCE_ID, MOCK_SESSION_ID, "prune")

      assert.ok(result.success)
      assert.equal(result.mode, "prune")

      getInstanceMock.mock.restore()
      if (originalBus) {
        ;(globalThis as any).messageStoreBus = originalBus
      } else {
        delete (globalThis as any).messageStoreBus
      }
    })
  })

  describe("checkAndTriggerAutoCompact", () => {
    it("does not trigger when user preference is never", async () => {
      updateCompactionConfig({
        autoCompactEnabled: true,
        autoCompactThreshold: 90,
        compactPreserveWindow: 5000,
        pruneReclaimThreshold: 10000,
        userPreference: "never",
        undoRetentionWindow: 5,
      })

      const shouldCompact = await checkAndTriggerAutoCompact(MOCK_INSTANCE_ID, MOCK_SESSION_ID)
      assert.ok(!shouldCompact)
    })

    it("returns false when no overflow", async () => {
      const mockStore = {
        getSessionUsage: () => createMockUsage(50000),
      }

      const getInstanceMock = mock.fn(() => mockStore)
      const originalBus = (globalThis as any).messageStoreBus
      ;(globalThis as any).messageStoreBus = { getInstance: getInstanceMock }

      const shouldCompact = await checkAndTriggerAutoCompact(MOCK_INSTANCE_ID, MOCK_SESSION_ID)
      assert.ok(!shouldCompact)

      getInstanceMock.mock.restore()
      if (originalBus) {
        ;(globalThis as any).messageStoreBus = originalBus
      } else {
        delete (globalThis as any).messageStoreBus
      }
    })

    it("triggers auto-compact when enabled", async () => {
      updateCompactionConfig({
        autoCompactEnabled: true,
        autoCompactThreshold: 90,
        compactPreserveWindow: 5000,
        pruneReclaimThreshold: 10000,
        userPreference: "auto",
        undoRetentionWindow: 5,
      })

      const mockStore = {
        getSessionUsage: () => createMockUsage(120000),
        getSessionMessageIds: () => [MOCK_MESSAGE_ID],
        getMessage: (id: string) => createMockMessage(id, "Test content"),
        upsertMessage: () => {},
        setMessageInfo: () => {},
      }

      const getInstanceMock = mock.fn(() => mockStore)
      const originalBus = (globalThis as any).messageStoreBus
      ;(globalThis as any).messageStoreBus = { getInstance: getInstanceMock }

      const shouldCompact = await checkAndTriggerAutoCompact(MOCK_INSTANCE_ID, MOCK_SESSION_ID)
      assert.ok(shouldCompact)

      getInstanceMock.mock.restore()
      if (originalBus) {
        ;(globalThis as any).messageStoreBus = originalBus
      } else {
        delete (globalThis as any).messageStoreBus
      }
    })
  })
})
