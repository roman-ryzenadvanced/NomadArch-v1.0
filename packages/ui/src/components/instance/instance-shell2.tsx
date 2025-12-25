import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from "solid-js"
import toast from "solid-toast"
import type { ToolState } from "@opencode-ai/sdk"
import { Accordion } from "@kobalte/core"
import { ChevronDown } from "lucide-solid"
import AppBar from "@suid/material/AppBar"
import Box from "@suid/material/Box"
import Divider from "@suid/material/Divider"
import Drawer from "@suid/material/Drawer"
import IconButton from "@suid/material/IconButton"
import Toolbar from "@suid/material/Toolbar"
import Typography from "@suid/material/Typography"
import useMediaQuery from "@suid/material/useMediaQuery"
import CloseIcon from "@suid/icons-material/Close"
import MenuIcon from "@suid/icons-material/Menu"
import MenuOpenIcon from "@suid/icons-material/MenuOpen"
import PushPinIcon from "@suid/icons-material/PushPin"
import PushPinOutlinedIcon from "@suid/icons-material/PushPinOutlined"
import type { Instance } from "../../types/instance"
import type { Command } from "../../lib/commands"
import {
  activeParentSessionId,
  activeSessionId as activeSessionMap,
  getSessionFamily,
  getSessionInfo,
  sessions,
  setActiveSession,
  executeCustomCommand,
  sendMessage,
  runShellCommand,
} from "../../stores/sessions"
import { compactSession } from "../../stores/session-actions";
import { addTask, setActiveTask } from "../../stores/task-actions"
import { keyboardRegistry, type KeyboardShortcut } from "../../lib/keyboard-registry"
import { messageStoreBus } from "../../stores/message-v2/bus"
import { clearSessionRenderCache } from "../message-block"
import { buildCustomCommandEntries } from "../../lib/command-utils"
import { getCommands as getInstanceCommands } from "../../stores/commands"
import { isOpen as isCommandPaletteOpen, hideCommandPalette, showCommandPalette } from "../../stores/command-palette"
import SessionList from "../session-list"
import KeyboardHint from "../keyboard-hint"
import InstanceWelcomeView from "../instance-welcome-view"
import InfoView from "../info-view"
import InstanceServiceStatus from "../instance-service-status"
import AgentSelector from "../agent-selector"
import ModelSelector from "../model-selector"
import ModelStatusSelector from "../model-status-selector"
import CommandPalette from "../command-palette"
import Kbd from "../kbd"
// Using rebuilt MultiX v2 with polling architecture (no freeze)
import MultiTaskChat from "../chat/multix-v2"
import { TodoListView } from "../tool-call/renderers/todo"
import ContextUsagePanel from "../session/context-usage-panel"
import SessionView from "../session/session-view"
import { Sidebar, type FileNode } from "./sidebar"
import { Editor } from "./editor"
import { serverApi } from "../../lib/api-client"
import { Sparkles, Layout as LayoutIcon, Terminal as TerminalIcon, Search, Loader2, Zap, Shield, Settings, FileArchive } from "lucide-solid"
import { formatTokenTotal } from "../../lib/formatters"
import { sseManager } from "../../lib/sse-manager"
import { getLogger } from "../../lib/logger"
import AdvancedSettingsModal from "../advanced-settings-modal"
import { showConfirmDialog } from "../../stores/alerts"
import {
  getSoloState,
  toggleAutonomous,
  toggleAutoApproval,
} from "../../stores/solo-store"
import {
  SESSION_SIDEBAR_EVENT,
  type SessionSidebarRequestAction,
  type SessionSidebarRequestDetail,
} from "../../lib/session-sidebar-events"

const log = getLogger("session")

interface InstanceShellProps {
  instance: Instance
  escapeInDebounce: boolean
  paletteCommands: Accessor<Command[]>
  onCloseSession: (sessionId: string) => Promise<void> | void
  onNewSession: () => Promise<void> | void
  handleSidebarAgentChange: (sessionId: string, agent: string) => Promise<void>
  handleSidebarModelChange: (sessionId: string, model: { providerId: string; modelId: string }) => Promise<void>
  onExecuteCommand: (command: Command) => void
  tabBarOffset: number
}

const DEFAULT_SESSION_SIDEBAR_WIDTH = 280
const MIN_SESSION_SIDEBAR_WIDTH = 220
const MAX_SESSION_SIDEBAR_WIDTH = 360
const RIGHT_DRAWER_WIDTH = 260
const MIN_RIGHT_DRAWER_WIDTH = 200
const MAX_RIGHT_DRAWER_WIDTH = 380
const SESSION_CACHE_LIMIT = 2
const APP_BAR_HEIGHT = 56
const LEFT_DRAWER_STORAGE_KEY = "opencode-session-sidebar-width-v8"
const RIGHT_DRAWER_STORAGE_KEY = "opencode-session-right-drawer-width-v1"
const LEFT_PIN_STORAGE_KEY = "opencode-session-left-drawer-pinned-v1"
const RIGHT_PIN_STORAGE_KEY = "opencode-session-right-drawer-pinned-v1"
const BUILD_PREVIEW_EVENT = "opencode:build-preview"




type LayoutMode = "desktop" | "tablet" | "phone"

const clampWidth = (value: number) => Math.min(MAX_SESSION_SIDEBAR_WIDTH, Math.max(MIN_SESSION_SIDEBAR_WIDTH, value))
const clampRightWidth = (value: number) => Math.min(MAX_RIGHT_DRAWER_WIDTH, Math.max(MIN_RIGHT_DRAWER_WIDTH, value))
const getPinStorageKey = (side: "left" | "right") => (side === "left" ? LEFT_PIN_STORAGE_KEY : RIGHT_PIN_STORAGE_KEY)
function readStoredPinState(side: "left" | "right", defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue
  const stored = window.localStorage.getItem(getPinStorageKey(side))
  if (stored === "true") return true
  if (stored === "false") return false
  return defaultValue
}
function persistPinState(side: "left" | "right", value: boolean) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(getPinStorageKey(side), value ? "true" : "false")
}

const InstanceShell2: Component<InstanceShellProps> = (props) => {
  const [sessionSidebarWidth, setSessionSidebarWidth] = createSignal(DEFAULT_SESSION_SIDEBAR_WIDTH)
  const [rightDrawerWidth, setRightDrawerWidth] = createSignal(RIGHT_DRAWER_WIDTH)
  const [leftPinned, setLeftPinned] = createSignal(true)
  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightPinned, setRightPinned] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(true)
  const [cachedSessionIds, setCachedSessionIds] = createSignal<string[]>([])
  const [pendingEvictions, setPendingEvictions] = createSignal<string[]>([])
  const [drawerHost, setDrawerHost] = createSignal<HTMLElement | null>(null)
  const [floatingDrawerTop, setFloatingDrawerTop] = createSignal(0)
  const [floatingDrawerHeight, setFloatingDrawerHeight] = createSignal(0)
  const [leftDrawerContentEl, setLeftDrawerContentEl] = createSignal<HTMLElement | null>(null)
  const [rightDrawerContentEl, setRightDrawerContentEl] = createSignal<HTMLElement | null>(null)
  const [leftToggleButtonEl, setLeftToggleButtonEl] = createSignal<HTMLElement | null>(null)
  const [rightToggleButtonEl, setRightToggleButtonEl] = createSignal<HTMLElement | null>(null)
  const [activeResizeSide, setActiveResizeSide] = createSignal<"left" | "right" | "chat" | "terminal" | null>(null)
  const [resizeStartX, setResizeStartX] = createSignal(0)
  const [resizeStartWidth, setResizeStartWidth] = createSignal(0)
  const [resizeStartY, setResizeStartY] = createSignal(0)
  const [resizeStartHeight, setResizeStartHeight] = createSignal(0)
  const [chatPanelWidth, setChatPanelWidth] = createSignal(600)
  const [terminalPanelHeight, setTerminalPanelHeight] = createSignal(200)
  const [terminalOpen, setTerminalOpen] = createSignal(false)
  const [rightPanelExpandedItems, setRightPanelExpandedItems] = createSignal<string[]>(["lsp", "mcp", "plan"])
  const [currentFile, setCurrentFile] = createSignal<FileNode | null>(null)
  const [centerTab, setCenterTab] = createSignal<"code" | "preview">("code")
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null)
  const [isSoloOpen, setIsSoloOpen] = createSignal(true)
  const [showAdvancedSettings, setShowAdvancedSettings] = createSignal(false)
  const [selectedBinary, setSelectedBinary] = createSignal("opencode")

  // Handler to load file content when selected
  createEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).ACTIVE_INSTANCE_ID = props.instance.id;
    }
  });

  const handleFileSelect = async (file: FileNode) => {
    try {
      const response = await serverApi.readWorkspaceFile(props.instance.id, file.path)
      const language = file.name.split('.').pop() || 'text'
      const updatedFile = {
        ...file,
        content: response.contents,
        language,
      }
      setCurrentFile(updatedFile)

      // If it's a previewable file, update the preview URL
      if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
        const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
        const apiOrigin = origin.replace(":3000", ":9898")
        const url = `${apiOrigin}/api/workspaces/${props.instance.id}/serve/${file.path}`
        setPreviewUrl(url)
      }
    } catch (error) {
      log.error('Failed to read file content', error)
      setCurrentFile(file)
    }
  }

  const messageStore = createMemo(() => messageStoreBus.getOrCreate(props.instance.id))

  const desktopQuery = useMediaQuery("(min-width: 1280px)")

  const tabletQuery = useMediaQuery("(min-width: 768px)")

  const layoutMode = createMemo<LayoutMode>(() => {
    if (desktopQuery()) return "desktop"
    if (tabletQuery()) return "tablet"
    return "phone"
  })

  const isPhoneLayout = createMemo(() => layoutMode() === "phone")
  const leftPinningSupported = createMemo(() => layoutMode() === "desktop")
  const rightPinningSupported = createMemo(() => layoutMode() !== "phone")

  const persistPinIfSupported = (side: "left" | "right", value: boolean) => {
    if (side === "left" && !leftPinningSupported()) return
    if (side === "right" && !rightPinningSupported()) return
    persistPinState(side, value)
  }

  createEffect(() => {
    switch (layoutMode()) {
      case "desktop": {
        const leftSaved = readStoredPinState("left", true)
        const rightSaved = readStoredPinState("right", true)
        setLeftPinned(leftSaved)
        setLeftOpen(leftSaved)
        setRightPinned(rightSaved)
        setRightOpen(rightSaved)
        break
      }
      case "tablet": {
        const rightSaved = readStoredPinState("right", true)
        setLeftPinned(false)
        setLeftOpen(false)
        setRightPinned(rightSaved)
        setRightOpen(rightSaved)
        break
      }
      default:
        setLeftPinned(false)
        setLeftOpen(false)
        setRightPinned(false)
        setRightOpen(false)
        break
    }
  })

  const measureDrawerHost = () => {
    if (typeof window === "undefined") return
    const host = drawerHost()
    if (!host) return
    const rect = host.getBoundingClientRect()
    const toolbar = host.querySelector<HTMLElement>(".session-toolbar")
    const toolbarHeight = toolbar?.offsetHeight ?? APP_BAR_HEIGHT
    setFloatingDrawerTop(rect.top + toolbarHeight)
    setFloatingDrawerHeight(Math.max(0, rect.height - toolbarHeight))
  }

  onMount(() => {
    if (typeof window === "undefined") return

    const savedLeft = window.localStorage.getItem(LEFT_DRAWER_STORAGE_KEY)
    if (savedLeft) {
      const parsed = Number.parseInt(savedLeft, 10)
      if (Number.isFinite(parsed)) {
        setSessionSidebarWidth(clampWidth(parsed))
      }
    }

    const savedRight = window.localStorage.getItem(RIGHT_DRAWER_STORAGE_KEY)
    if (savedRight) {
      const parsed = Number.parseInt(savedRight, 10)
      if (Number.isFinite(parsed)) {
        setRightDrawerWidth(clampRightWidth(parsed))
      }
    }

    const handleResize = () => {
      const width = clampWidth(window.innerWidth * 0.3)
      setSessionSidebarWidth((current) => clampWidth(current || width))
      measureDrawerHost()
    }

    handleResize()
    window.addEventListener("resize", handleResize)
    onCleanup(() => window.removeEventListener("resize", handleResize))
  })

  onMount(() => {
    if (typeof window === "undefined") return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SessionSidebarRequestDetail>).detail
      if (!detail || detail.instanceId !== props.instance.id) return
      handleSidebarRequest(detail.action)
    }
    window.addEventListener(SESSION_SIDEBAR_EVENT, handler)
    onCleanup(() => window.removeEventListener(SESSION_SIDEBAR_EVENT, handler))
  })

  onMount(() => {
    if (typeof window === "undefined") return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId: string; sessionId: string }>).detail
      if (!detail || detail.instanceId !== props.instance.id) return
      setShowAdvancedSettings(true)
    }
    window.addEventListener("open-advanced-settings", handler)
    onCleanup(() => window.removeEventListener("open-advanced-settings", handler))
  })

  onMount(() => {
    if (typeof window === "undefined") return
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string; instanceId?: string }>).detail
      console.log(`[InstanceShell2] Received BUILD_PREVIEW_EVENT`, {
        detail,
        currentInstanceId: props.instance.id,
        match: detail?.instanceId === props.instance.id
      });
      if (!detail || detail.instanceId !== props.instance.id || !detail.url) return

      setPreviewUrl(detail.url)

      // Auto-switch to preview mode for new AI content
      setCenterTab("preview")
      toast.success("Preview updated", {
        icon: '🚀',
        duration: 3000,
        position: 'bottom-center'
      })
    }
    window.addEventListener(BUILD_PREVIEW_EVENT, handler)
    onCleanup(() => window.removeEventListener(BUILD_PREVIEW_EVENT, handler))
  })

  onMount(() => {
    if (typeof window === "undefined") return
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ code: string; fileName: string | null; instanceId: string }>).detail
      if (!detail || detail.instanceId !== props.instance.id) return

      if (detail.fileName) {
        const origin = window.location.origin
        const apiOrigin = origin.includes(":3000") ? origin.replace(":3000", ":9898") : origin
        const url = `${apiOrigin}/api/workspaces/${props.instance.id}/serve/${detail.fileName}`
        setPreviewUrl(url)
      } else {
        const blob = new Blob([detail.code], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      }

      setCenterTab("preview")
      toast.success("Previewing code block", {
        icon: '🔍',
        duration: 2000,
        position: 'bottom-center'
      })
    }
    window.addEventListener("MANUAL_PREVIEW_EVENT", handler)
    onCleanup(() => window.removeEventListener("MANUAL_PREVIEW_EVENT", handler))
  })

  createEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(LEFT_DRAWER_STORAGE_KEY, sessionSidebarWidth().toString())
  })

  createEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(RIGHT_DRAWER_STORAGE_KEY, rightDrawerWidth().toString())
  })

  createEffect(() => {
    props.tabBarOffset
    requestAnimationFrame(() => measureDrawerHost())
  })

  const activeSessions = createMemo(() => {
    const parentId = activeParentSessionId().get(props.instance.id)
    if (!parentId) return new Map<string, ReturnType<typeof getSessionFamily>[number]>()
    const sessionFamily = getSessionFamily(props.instance.id, parentId)
    return new Map(sessionFamily.map((s) => [s.id, s]))
  })

  const activeSessionIdForInstance = createMemo(() => {
    return activeSessionMap().get(props.instance.id) || null
  })

  const parentSessionIdForInstance = createMemo(() => {
    return activeParentSessionId().get(props.instance.id) || null
  })

  const activeSessionForInstance = createMemo(() => {
    const sessionId = activeSessionIdForInstance()
    if (!sessionId || sessionId === "info") return null
    const instanceSessions = sessions().get(props.instance.id)
    return instanceSessions?.get(sessionId) ?? null
  })

  const activeSessionUsage = createMemo(() => {
    const sessionId = activeSessionIdForInstance()
    if (!sessionId) return null
    const store = messageStore()
    return store?.getSessionUsage(sessionId) ?? null
  })

  const activeSessionInfoDetails = createMemo(() => {
    const sessionId = activeSessionIdForInstance()
    if (!sessionId) return null
    return getSessionInfo(props.instance.id, sessionId) ?? null
  })

  const tokenStats = createMemo(() => {
    const usage = activeSessionUsage()
    const info = activeSessionInfoDetails()
    return {
      used: usage?.actualUsageTokens ?? info?.actualUsageTokens ?? 0,
      avail: info?.contextAvailableTokens ?? null,
    }
  })

  const latestTodoSnapshot = createMemo(() => {
    const sessionId = activeSessionIdForInstance()
    if (!sessionId || sessionId === "info") return null
    const store = messageStore()
    if (!store) return null
    const snapshot = store.state.latestTodos[sessionId]
    return snapshot ?? null
  })

  const latestTodoState = createMemo<ToolState | null>(() => {
    const snapshot = latestTodoSnapshot()
    if (!snapshot) return null
    const store = messageStore()
    if (!store) return null
    const message = store.getMessage(snapshot.messageId)
    if (!message) return null
    const partRecord = message.parts?.[snapshot.partId]
    const part = partRecord?.data as { type?: string; tool?: string; state?: ToolState }
    if (!part || part.type !== "tool" || part.tool !== "todowrite") return null
    const state = part.state
    if (!state || state.status !== "completed") return null
    return state
  })

  const connectionStatus = () => sseManager.getStatus(props.instance.id)
  const connectionStatusClass = () => {
    const status = connectionStatus()
    if (status === "connecting") return "connecting"
    if (status === "connected") return "connected"
    return "disconnected"
  }

  const handleCommandPaletteClick = () => {
    showCommandPalette(props.instance.id)
  }

  /* Compact Logic */
  const [isCompacting, setIsCompacting] = createSignal(false);
  const handleCompact = async () => {
    const sessionId = activeSessionIdForInstance();
    if (!sessionId || sessionId === "info" || isCompacting()) return;

    setIsCompacting(true);
    const toastId = toast.loading("Compacting...", { icon: <FileArchive class="animate-pulse text-indigo-400" /> });
    try {
      await compactSession(props.instance.id, sessionId);
      toast.success("Session compacted!", { id: toastId });
    } catch (e) {
      toast.error("Failed to compact", { id: toastId });
    } finally {
      setIsCompacting(false);
    }
  }

  const [isFixing, setIsFixing] = createSignal(false)
  const [isBuilding, setIsBuilding] = createSignal(false)

  const handleSmartFix = async () => {
    const parentSessionId = activeSessionIdForInstance()
    if (!parentSessionId || parentSessionId === "info" || isFixing()) {
      return
    }

    setIsFixing(true)
    const toastId = toast.loading("Smart Fix: Creating analysis task...", {
      icon: <Sparkles class="text-indigo-400 animate-spin" />
    });
    try {
      // ALWAYS create a dedicated "Smart Fix" task in the MultiX pipeline
      // This ensures the analysis and fixes appear in their own tab
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      const taskResult = await addTask(
        props.instance.id,
        parentSessionId,
        `🔧 Smart Fix ${timestamp}`
      )

      const targetSessionId = taskResult.taskSessionId || parentSessionId
      const taskId = taskResult.id

      // Set this as the active task so the user sees it immediately
      setActiveTask(props.instance.id, parentSessionId, taskId)

      toast.loading("Analyzing project...", { id: toastId });

      // Use sendMessage to force visible feedback in the chat stream
      // Prompt enforces: Report → Plan → Approval → Execute workflow
      const smartFixPrompt = `**Smart Fix Analysis Request**

Please analyze this project for errors, bugs, warnings, or potential improvements.

**Your response MUST follow this exact format:**

1. **ANALYSIS RESULTS:**
   - If NO errors/issues found: Clearly state "✅ No errors or issues detected in the project."
   - If errors/issues ARE found: List each issue with file path and line number if applicable.

2. **FIX PLAN (only if issues found):**
   For each issue, outline:
   - What the problem is
   - How you will fix it
   - Which files will be modified

3. **AWAIT APPROVAL:**
   After presenting the plan, explicitly ask: "Do you approve this fix plan? Reply 'yes' to proceed, or provide feedback for adjustments."

4. **EXECUTION (only after I say 'yes'):**
   Only apply fixes after receiving explicit approval. Use write_file tool to make changes.

Now analyze the project and report your findings.`

      await sendMessage(
        props.instance.id,
        targetSessionId,
        smartFixPrompt,
        [],
        taskId
      )

      toast.success("Smart Fix task created. Check the pipeline.", { id: toastId, duration: 3000 });

      // Auto-open right panel to show agent progress if it's not open
      if (!rightOpen()) {
        setRightOpen(true)
        measureDrawerHost()
      }
    } catch (error) {
      log.error("Failed to run Smart Fix command", error)
      toast.error("Smart Fix failed to start", { id: toastId });
    } finally {
      setTimeout(() => setIsFixing(false), 2000) // Reset after delay
    }
  }

  const handleBuild = async () => {
    const sessionId = activeSessionIdForInstance()
    if (!sessionId || sessionId === "info" || isBuilding()) {
      return
    }

    setIsBuilding(true)
    try {
      await runShellCommand(props.instance.id, sessionId, "build")

      // Auto-open right panel to show build logs if it's not open
      if (!rightOpen()) {
        setRightOpen(true)
        measureDrawerHost()
      }
    } catch (error) {
      log.error("Failed to run Build command", error)
    } finally {
      setTimeout(() => setIsBuilding(false), 2000) // Reset after delay
    }
  }

  const customCommands = createMemo(() => buildCustomCommandEntries(props.instance.id, getInstanceCommands(props.instance.id)))

  const instancePaletteCommands = createMemo(() => [...props.paletteCommands(), ...customCommands()])
  const paletteOpen = createMemo(() => isCommandPaletteOpen(props.instance.id))

  const keyboardShortcuts = createMemo(() =>
    [keyboardRegistry.get("session-prev"), keyboardRegistry.get("session-next")].filter(
      (shortcut): shortcut is KeyboardShortcut => Boolean(shortcut),
    ),
  )

  interface PendingSidebarAction {
    action: SessionSidebarRequestAction
    id: number
  }

  let sidebarActionId = 0
  const [pendingSidebarAction, setPendingSidebarAction] = createSignal<PendingSidebarAction | null>(null)
  const [sidebarRequestedTab, setSidebarRequestedTab] = createSignal<string | null>(null)

  const triggerKeyboardEvent = (target: HTMLElement, options: { key: string; code: string; keyCode: number }) => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: options.key,
        code: options.code,
        keyCode: options.keyCode,
        which: options.keyCode,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const focusAgentSelectorControl = () => {
    const agentTrigger = leftDrawerContentEl()?.querySelector("[data-agent-selector]") as HTMLElement | null
    if (!agentTrigger) return false
    agentTrigger.focus()
    setTimeout(() => triggerKeyboardEvent(agentTrigger, { key: "Enter", code: "Enter", keyCode: 13 }), 10)
    return true
  }

  const focusModelSelectorControl = () => {
    const input = leftDrawerContentEl()?.querySelector<HTMLInputElement>("[data-model-selector]")
    if (!input) return false
    input.focus()
    setTimeout(() => triggerKeyboardEvent(input, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }), 10)
    return true
  }

  createEffect(() => {
    const pending = pendingSidebarAction()
    if (!pending) return
    const action = pending.action
    const contentReady = Boolean(leftDrawerContentEl())
    if (!contentReady) {
      return
    }
    if (action === "show-session-list") {
      setPendingSidebarAction(null)
      return
    }
    const handled = action === "focus-agent-selector" ? focusAgentSelectorControl() : focusModelSelectorControl()
    if (handled) {
      setPendingSidebarAction(null)
    }
  })

  const handleSidebarRequest = (action: SessionSidebarRequestAction) => {
    setPendingSidebarAction({ action, id: sidebarActionId++ })
    if (action === "show-skills") {
      setSidebarRequestedTab("skills")
    }
    if (!leftPinned() && !leftOpen()) {
      setLeftOpen(true)
      measureDrawerHost()
    }
  }

  const closeFloatingDrawersIfAny = () => {
    let handled = false
    if (!leftPinned() && leftOpen()) {
      setLeftOpen(false)
      blurIfInside(leftDrawerContentEl())
      focusTarget(leftToggleButtonEl())
      handled = true
    }
    if (!rightPinned() && rightOpen()) {
      setRightOpen(false)
      blurIfInside(rightDrawerContentEl())
      focusTarget(rightToggleButtonEl())
      handled = true
    }
    return handled
  }

  onMount(() => {
    if (typeof window === "undefined") return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!closeFloatingDrawersIfAny()) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("keydown", handleEscape, true)
    onCleanup(() => window.removeEventListener("keydown", handleEscape, true))
  })

  const handleSessionSelect = (sessionId: string) => {
    setActiveSession(props.instance.id, sessionId)
  }


  const evictSession = (sessionId: string) => {
    if (!sessionId) return
    log.info("Evicting cached session", { instanceId: props.instance.id, sessionId })
    const store = messageStoreBus.getInstance(props.instance.id)
    store?.clearSession(sessionId)
    clearSessionRenderCache(props.instance.id, sessionId)
  }

  const scheduleEvictions = (ids: string[]) => {
    if (!ids.length) return
    setPendingEvictions((current) => {
      const existing = new Set(current)
      const next = [...current]
      ids.forEach((id) => {
        if (!existing.has(id)) {
          next.push(id)
          existing.add(id)
        }
      })
      return next
    })
  }

  createEffect(() => {
    const pending = pendingEvictions()
    if (!pending.length) return
    const cached = new Set(cachedSessionIds())
    const remaining: string[] = []
    pending.forEach((id) => {
      if (cached.has(id)) {
        remaining.push(id)
      } else {
        evictSession(id)
      }
    })
    if (remaining.length !== pending.length) {
      setPendingEvictions(remaining)
    }
  })

  createEffect(() => {
    const sessionsMap = activeSessions()
    const parentId = parentSessionIdForInstance()
    const activeId = activeSessionIdForInstance()
    setCachedSessionIds((current) => {
      const next: string[] = []
      const append = (id: string | null) => {
        if (!id || id === "info") return
        if (!sessionsMap.has(id)) return
        if (next.includes(id)) return
        next.push(id)
      }

      append(parentId)
      append(activeId)

      const limit = parentId ? SESSION_CACHE_LIMIT + 1 : SESSION_CACHE_LIMIT
      const trimmed = next.length > limit ? next.slice(0, limit) : next
      const trimmedSet = new Set(trimmed)
      const removed = current.filter((id) => !trimmedSet.has(id))
      if (removed.length) {
        scheduleEvictions(removed)
      }
      return trimmed
    })
  })

  const showEmbeddedSidebarToggle = createMemo(() => !leftPinned() && !leftOpen())

  const drawerContainer = () => {
    const host = drawerHost()
    if (host) return host
    if (typeof document !== "undefined") {
      return document.body
    }
    return undefined
  }

  const fallbackDrawerTop = () => APP_BAR_HEIGHT + props.tabBarOffset
  const floatingTop = () => {
    const measured = floatingDrawerTop()
    if (measured > 0) return measured
    return fallbackDrawerTop()
  }
  const floatingTopPx = () => `${floatingTop()}px`
  const floatingHeight = () => {
    const measured = floatingDrawerHeight()
    if (measured > 0) return `${measured}px`
    return `calc(100% - ${floatingTop()}px)`
  }

  const scheduleDrawerMeasure = () => {
    if (typeof window === "undefined") {
      measureDrawerHost()
      return
    }
    requestAnimationFrame(() => measureDrawerHost())
  }

  const applyDrawerWidth = (side: "left" | "right", width: number) => {
    if (side === "left") {
      setSessionSidebarWidth(width)
    } else {
      setRightDrawerWidth(width)
    }
    scheduleDrawerMeasure()
  }

  const applyPanelSize = (type: "chat" | "terminal", size: number) => {
    if (type === "chat") {
      setChatPanelWidth(size)
    } else {
      setTerminalPanelHeight(size)
    }
  }

  const handlePointerMove = (clientX: number, clientY: number) => {
    const side = activeResizeSide()
    if (!side) return

    if (side === "left" || side === "right") {
      const startWidth = resizeStartWidth()
      const clamp = side === "left" ? clampWidth : clampRightWidth
      const delta = side === "left" ? clientX - resizeStartX() : resizeStartX() - clientX
      const nextWidth = clamp(startWidth + delta)
      applyDrawerWidth(side, nextWidth)
    } else if (side === "chat") {
      const startWidth = resizeStartWidth()
      const delta = resizeStartX() - clientX // Dragging left increases width
      const nextWidth = Math.max(300, Math.min(window.innerWidth - 300, startWidth + delta))
      applyPanelSize("chat", nextWidth)
    } else if (side === "terminal") {
      const startHeight = resizeStartHeight()
      const delta = resizeStartY() - clientY // Dragging up increases height
      const nextHeight = Math.max(100, Math.min(window.innerHeight - 200, startHeight + delta))
      applyPanelSize("terminal", nextHeight)
    }
  }

  function stopDrawerResize() {
    setActiveResizeSide(null)
    document.removeEventListener("mousemove", drawerMouseMove)
    document.removeEventListener("mouseup", drawerMouseUp)
    document.removeEventListener("touchmove", drawerTouchMove)
    document.removeEventListener("touchend", drawerTouchEnd)
  }

  function drawerMouseMove(event: MouseEvent) {
    event.preventDefault()
    handlePointerMove(event.clientX, event.clientY)
  }

  function drawerMouseUp() {
    stopDrawerResize()
  }

  function drawerTouchMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (!touch) return
    event.preventDefault()
    handlePointerMove(touch.clientX, touch.clientY)
  }

  function drawerTouchEnd() {
    stopDrawerResize()
  }

  const startResize = (side: "left" | "right" | "chat" | "terminal", clientX: number, clientY: number) => {
    setActiveResizeSide(side)
    setResizeStartX(clientX)
    setResizeStartY(clientY)

    if (side === "left") setResizeStartWidth(sessionSidebarWidth())
    else if (side === "right") setResizeStartWidth(rightDrawerWidth())
    else if (side === "chat") setResizeStartWidth(chatPanelWidth())
    else if (side === "terminal") setResizeStartHeight(terminalPanelHeight())

    document.addEventListener("mousemove", drawerMouseMove)
    document.addEventListener("mouseup", drawerMouseUp)
    document.addEventListener("touchmove", drawerTouchMove, { passive: false })
    document.addEventListener("touchend", drawerTouchEnd)
  }

  const handleResizeMouseDown = (side: "left" | "right" | "chat" | "terminal") => (event: MouseEvent) => {
    event.preventDefault()
    startResize(side, event.clientX, event.clientY)
  }

  const handleDrawerResizeTouchStart = (side: "left" | "right") => (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    event.preventDefault()
    startResize(side, touch.clientX, touch.clientY)
  }

  onCleanup(() => {
    stopDrawerResize()
  })

  type DrawerViewState = "pinned" | "floating-open" | "floating-closed"


  const leftDrawerState = createMemo<DrawerViewState>(() => {
    if (leftPinned()) return "pinned"
    return leftOpen() ? "floating-open" : "floating-closed"
  })

  const rightDrawerState = createMemo<DrawerViewState>(() => {
    if (rightPinned()) return "pinned"
    return rightOpen() ? "floating-open" : "floating-closed"
  })

  const leftAppBarButtonLabel = () => {
    const state = leftDrawerState()
    if (state === "pinned") return "Left drawer pinned"
    if (state === "floating-closed") return "Open left drawer"
    return "Close left drawer"
  }

  const rightAppBarButtonLabel = () => {
    const state = rightDrawerState()
    if (state === "pinned") return "Right drawer pinned"
    if (state === "floating-closed") return "Open right drawer"
    return "Close right drawer"
  }

  const leftAppBarButtonIcon = () => {
    const state = leftDrawerState()
    if (state === "floating-closed") return <MenuIcon fontSize="small" />
    return <MenuOpenIcon fontSize="small" />
  }

  const rightAppBarButtonIcon = () => {
    const state = rightDrawerState()
    if (state === "floating-closed") return <MenuIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
    return <MenuOpenIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
  }




  const pinLeftDrawer = () => {
    blurIfInside(leftDrawerContentEl())
    batch(() => {
      setLeftPinned(true)
      setLeftOpen(true)
    })
    persistPinIfSupported("left", true)
    measureDrawerHost()
  }

  const unpinLeftDrawer = () => {
    blurIfInside(leftDrawerContentEl())
    batch(() => {
      setLeftPinned(false)
      setLeftOpen(true)
    })
    persistPinIfSupported("left", false)
    measureDrawerHost()
  }

  const pinRightDrawer = () => {
    blurIfInside(rightDrawerContentEl())
    batch(() => {
      setRightPinned(true)
      setRightOpen(true)
    })
    persistPinIfSupported("right", true)
    measureDrawerHost()
  }

  const unpinRightDrawer = () => {
    blurIfInside(rightDrawerContentEl())
    batch(() => {
      setRightPinned(false)
      setRightOpen(true)
    })
    persistPinIfSupported("right", false)
    measureDrawerHost()
  }

  const handleLeftAppBarButtonClick = () => {
    const state = leftDrawerState()
    if (state === "pinned") return
    if (state === "floating-closed") {
      setLeftOpen(true)
      measureDrawerHost()
      return
    }
    blurIfInside(leftDrawerContentEl())
    setLeftOpen(false)
    focusTarget(leftToggleButtonEl())
    measureDrawerHost()
  }

  const handleRightAppBarButtonClick = () => {
    const state = rightDrawerState()
    if (state === "pinned") return
    if (state === "floating-closed") {
      setRightOpen(true)
      setIsSoloOpen(false)
      measureDrawerHost()
      return
    }
    blurIfInside(rightDrawerContentEl())
    setRightOpen(false)
    setIsSoloOpen(false)
    focusTarget(rightToggleButtonEl())
    measureDrawerHost()
  }


  const focusTarget = (element: HTMLElement | null) => {
    if (!element) return
    requestAnimationFrame(() => {
      element.focus()
    })
  }

  const blurIfInside = (element: HTMLElement | null) => {
    if (typeof document === "undefined" || !element) return
    const active = document.activeElement as HTMLElement | null
    if (active && element.contains(active)) {
      active.blur()
    }
  }

  const closeLeftDrawer = () => {
    if (leftDrawerState() === "pinned") return
    blurIfInside(leftDrawerContentEl())
    setLeftOpen(false)
    focusTarget(leftToggleButtonEl())
  }
  const closeRightDrawer = () => {
    if (rightDrawerState() === "pinned") return
    blurIfInside(rightDrawerContentEl())
    setRightOpen(false)
    focusTarget(rightToggleButtonEl())
  }

  const formattedUsedTokens = () => formatTokenTotal(tokenStats().used)


  const formattedAvailableTokens = () => {
    const avail = tokenStats().avail
    if (typeof avail === "number") {
      return formatTokenTotal(avail)
    }
    return "--"
  }

  const LeftDrawerContent = () => (
    <Sidebar
      instanceId={props.instance.id}
      isOpen={leftOpen()}
      onFileSelect={handleFileSelect}
      sessions={Array.from(activeSessions().values())}
      activeSessionId={activeSessionIdForInstance() || undefined}
      onSessionSelect={handleSessionSelect}
      onOpenCommandPalette={handleCommandPaletteClick}
      onToggleTerminal={() => setTerminalOpen((current) => !current)}
      isTerminalOpen={terminalOpen()}
      onOpenAdvancedSettings={() => setShowAdvancedSettings(true)}
      requestedTab={sidebarRequestedTab()}
    />
  )

  const RightDrawerContent = () => {
    const sessionId = activeSessionIdForInstance()

    if (sessionId && sessionId !== "info") {
      return (
        <div class="flex flex-col h-full relative" ref={setRightDrawerContentEl}>
          <MultiTaskChat instanceId={props.instance.id} sessionId={sessionId} />
        </div>
      )
    }

    const renderPlanSectionContent = () => {
      const sessionId = activeSessionIdForInstance()
      if (!sessionId || sessionId === "info") {
        return <p class="text-xs text-secondary">Select a session to view plan.</p>
      }
      const todoState = latestTodoState()
      if (!todoState) {
        return <p class="text-xs text-secondary">Nothing planned yet.</p>
      }
      return <TodoListView state={todoState} emptyLabel="Nothing planned yet." showStatusLabel={false} />
    }

    const sections = [
      {
        id: "lsp",
        label: "LSP Servers",
        render: () => (
          <InstanceServiceStatus
            initialInstance={props.instance}
            sections={["lsp"]}
            showSectionHeadings={false}
            class="space-y-2"
          />
        ),
      },
      {
        id: "mcp",
        label: "MCP Servers",
        render: () => (
          <InstanceServiceStatus
            initialInstance={props.instance}
            sections={["mcp"]}
            showSectionHeadings={false}
            class="space-y-2"
          />
        ),
      },
      {
        id: "plan",
        label: "Plan",
        render: renderPlanSectionContent,
      },
    ]

    createEffect(() => {
      const currentExpanded = new Set(rightPanelExpandedItems())
      if (sections.every((section) => currentExpanded.has(section.id))) return
      setRightPanelExpandedItems(sections.map((section) => section.id))
    })

    const handleAccordionChange = (values: string[]) => {
      setRightPanelExpandedItems(values)
    }

    const isSectionExpanded = (id: string) => rightPanelExpandedItems().includes(id)

    return (
      <div class="flex flex-col h-full" ref={setRightDrawerContentEl}>
        <div class="flex items-center justify-between px-4 py-2 border-b border-base">
          <Typography variant="subtitle2" class="uppercase tracking-wide text-xs font-semibold">
            Status Panel
          </Typography>
          <div class="flex items-center gap-2">
            <Show when={!isPhoneLayout()}>
              <IconButton
                size="small"
                color="inherit"
                aria-label={rightPinned() ? "Unpin right drawer" : "Pin right drawer"}
                onClick={() => (rightPinned() ? unpinRightDrawer() : pinRightDrawer())}
              >
                {rightPinned() ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
              </IconButton>
            </Show>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <Accordion.Root
            class="flex flex-col"
            collapsible
            multiple
            value={rightPanelExpandedItems()}
            onChange={handleAccordionChange}
          >
            <For each={sections}>
              {(section) => (
                <Accordion.Item
                  value={section.id}
                  class="w-full border border-base bg-surface-secondary text-primary"
                >
                  <Accordion.Header>
                    <Accordion.Trigger class="w-full flex items-center justify-between gap-3 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide">
                      <span>{section.label}</span>
                      <ChevronDown
                        class={`h-4 w-4 transition-transform duration-150 ${isSectionExpanded(section.id) ? "rotate-180" : ""}`}
                      />
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content class="w-full px-3 pb-3 text-sm text-primary">
                    {section.render()}
                  </Accordion.Content>
                </Accordion.Item>
              )}
            </For>
          </Accordion.Root>
        </div>
      </div>
    )
  }

  const renderLeftPanel = () => {
    if (leftPinned()) {
      return (
        <Box
          class="session-sidebar-container"
          sx={{
            width: `${sessionSidebarWidth()}px`,
            flexShrink: 0,
            borderRight: "1px solid var(--border-base)",
            backgroundColor: "var(--surface-secondary)",
            height: "100%",
            minHeight: 0,
            position: "relative",
          }}
        >
          <div
            class="session-resize-handle session-resize-handle--left"
            onMouseDown={handleResizeMouseDown("left")}
            onTouchStart={handleDrawerResizeTouchStart("left")}
            role="presentation"
            aria-hidden="true"
          />
          <LeftDrawerContent />
        </Box>
      )
    }
    const container = drawerContainer()
    const modalProps = container ? { container: container as Element } : undefined
    return (
      <Drawer
        anchor="left"
        variant="temporary"
        open={leftOpen()}
        onClose={closeLeftDrawer}
        ModalProps={modalProps}
        sx={{
          "& .MuiDrawer-paper": {
            width: isPhoneLayout() ? "100vw" : `${sessionSidebarWidth()}px`,
            boxSizing: "border-box",
            borderRight: isPhoneLayout() ? "none" : "1px solid var(--border-base)",
            backgroundColor: "var(--surface-secondary)",
            backgroundImage: "none",
            color: "var(--text-primary)",
            boxShadow: "none",
            borderRadius: 0,
            top: floatingTopPx(),
            height: floatingHeight(),
          },

          "& .MuiBackdrop-root": {
            backgroundColor: "transparent",
          },
        }}
      >
        <LeftDrawerContent />
      </Drawer>
    )
  }


  const renderRightPanel = () => {
    if (isSoloOpen()) return null; // MultiX Mode uses the main stream area

    if (rightPinned()) {
      return (
        <Box
          class="session-right-panel"
          sx={{
            width: `${rightDrawerWidth()}px`,
            flexShrink: 0,
            borderLeft: "1px solid var(--border-base)",
            backgroundColor: "var(--surface-secondary)",
            height: "100%",
            minHeight: 0,
            position: "relative",
          }}
        >
          <div
            class="session-resize-handle session-resize-handle--right"
            onMouseDown={handleResizeMouseDown("right")}
            onTouchStart={handleDrawerResizeTouchStart("right")}
            role="presentation"
            aria-hidden="true"
          />
          <RightDrawerContent />
        </Box>
      )
    }
    const container = drawerContainer()
    const modalProps = container ? { container: container as Element } : undefined
    return (
      <Drawer
        anchor="right"
        variant="temporary"
        open={rightOpen()}
        onClose={closeRightDrawer}
        ModalProps={modalProps}
        sx={{
          "& .MuiDrawer-paper": {
            width: isPhoneLayout() ? "100vw" : `${rightDrawerWidth()}px`,
            boxSizing: "border-box",
            borderLeft: isPhoneLayout() ? "none" : "1px solid var(--border-base)",
            backgroundColor: "var(--surface-secondary)",
            backgroundImage: "none",
            color: "var(--text-primary)",
            boxShadow: "none",
            borderRadius: 0,
            top: floatingTopPx(),
            height: floatingHeight(),
          },
          "& .MuiBackdrop-root": {
            backgroundColor: "transparent",
          },
        }}
      >
        <RightDrawerContent />
      </Drawer>

    )
  }

  const hasSessions = createMemo(() => activeSessions().size > 0)

  const showingInfoView = createMemo(() => activeSessionIdForInstance() === "info")

  const sessionLayout = (
    <div
      class="session-shell-panels flex flex-col flex-1 min-h-0 w-full overflow-hidden relative bg-[#050505]"
      ref={(element) => {
        setDrawerHost(element)
        measureDrawerHost()
      }}
    >
      {/* Background Decorator - Antigravity Glows */}
      <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none z-0" />
      <div class="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-purple-600/5 blur-[100px] rounded-full pointer-events-none z-0" />

      <AppBar position="sticky" color="default" elevation={0} class="border-b border-white/5 bg-[#050505]/80 backdrop-blur-md z-20 shrink-0">
        <Toolbar variant="dense" class="session-toolbar flex items-center justify-between gap-2 py-0 min-h-[48px]">
          <div class="flex items-center space-x-4">
            <IconButton
              ref={setLeftToggleButtonEl}
              color="inherit"
              onClick={handleLeftAppBarButtonClick}
              aria-label={leftAppBarButtonLabel()}
              size="small"
              class="text-zinc-500 hover:text-zinc-200"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
            <div class="flex items-center space-x-2">
              <div class="w-2.5 h-2.5 rounded-full bg-[#f87171] opacity-60" />
              <div class="w-2.5 h-2.5 rounded-full bg-[#fbbf24] opacity-60" />
              <div class="w-2.5 h-2.5 rounded-full bg-[#4ade80] opacity-60" />
            </div>
          </div>

          <div class="hidden md:flex items-center bg-white/5 border border-white/5 rounded-full px-3 py-1 space-x-2 text-zinc-400 group hover:border-white/10 transition-all cursor-pointer" onClick={handleCommandPaletteClick}>
            <Search size={14} />
            <span class="text-[11px] min-w-[200px]">Search your project...</span>
            <div class="flex items-center space-x-1 opacity-40">
              <Kbd shortcut="cmd+shift+p" />
            </div>
          </div>

          <div class="flex items-center space-x-4">
            <Show when={activeSessionIdForInstance() && activeSessionIdForInstance() !== "info"}>
              <div class="flex items-center space-x-2">
                {/* Compact Button */}
                <button
                  onClick={handleCompact}
                  disabled={isCompacting()}
                  class="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/40 transition-all rounded-full"
                  title="Compact Context: Summarize conversation to save tokens"
                >
                  <Show when={isCompacting()} fallback={<FileArchive size={14} strokeWidth={2} />}>
                    <Loader2 size={14} class="animate-spin" />
                  </Show>
                  <span>Compact</span>
                </button>

                <ModelStatusSelector
                  instanceId={props.instance.id}
                  sessionId={activeSessionIdForInstance()!}
                  currentModel={activeSessionForInstance()?.model || { providerId: "", modelId: "" }}
                  onModelChange={async (model) => {
                    const sid = activeSessionIdForInstance()
                    if (sid) await props.handleSidebarModelChange(sid, model)
                  }}
                />
                <button
                  onClick={() => setShowAdvancedSettings(true)}
                  class="p-2 text-zinc-500 hover:text-blue-400 transition-all hover:bg-blue-500/10 rounded-full"
                  title="AI Settings: Manage model providers and API keys"
                >
                  <Settings size={14} strokeWidth={2} />
                </button>
              </div>
            </Show>

            {/* SmartX Mode Buttons (Integrated HUD) */}
            <div class="flex items-center bg-white/5 border border-white/5 rounded-full px-2 py-1 space-x-1">
              <button
                onClick={handleSmartFix}
                disabled={isFixing()}
                title="Smart Fix: Automatically detect and fix issues in your code"
                class={`transition-all flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${isFixing() ? "text-blue-500 smart-fix-highlight bg-blue-500/10" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}
              >
                <Zap size={12} class={isFixing() ? "animate-bounce" : ""} />
                <span>Fix</span>
              </button>
              <div class="w-px h-3 bg-white/10" />
              <button
                onClick={handleBuild}
                disabled={isBuilding()}
                title="Build: Build and deploy your application"
                class={`transition-all flex items-center space-x-1.5 px-2 py-1 rounded-full hover:bg-white/10 ${isBuilding() ? "text-indigo-500" : "text-zinc-400 hover:text-white"}`}
              >
                <Show when={isBuilding()} fallback={<TerminalIcon size={14} />}>
                  <Loader2 size={14} class="animate-spin text-indigo-400" />
                </Show>
                <span class="text-[10px] font-bold uppercase tracking-tight">
                  {isBuilding() ? "BUILDING..." : "BUILD"}
                </span>
              </button>
            </div>

            {/* APEX PRO Mode & Auto-Approval Toggles */}
            <div class="flex items-center bg-white/5 border border-white/5 rounded-full px-1.5 py-1 space-x-1">
              <button
                onClick={() => toggleAutonomous(props.instance.id)}
                title="Autonomous Mode (APEX PRO): Enable autonomous AI agent operations"
                class={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full transition-all ${getSoloState(props.instance.id).isAutonomous
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
                  }`}
              >
                <Zap size={12} class={getSoloState(props.instance.id).isAutonomous ? "animate-pulse" : ""} />
                <span class="text-[9px] font-black uppercase tracking-tighter">APEX PRO</span>
              </button>
              <button
                onClick={() => toggleAutoApproval(props.instance.id)}
                title="Auto-Approval (SHIELD): Automatically approve AI agent actions"
                class={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full transition-all ${getSoloState(props.instance.id).autoApproval
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
                  }`}
              >
                <Shield size={12} />
                <span class="text-[9px] font-black uppercase tracking-tighter">Shield</span>
              </button>
            </div>

            <button
              onClick={() => {
                const newState = !(rightOpen() && isSoloOpen())
                setRightOpen(newState)
                setIsSoloOpen(newState)
              }}
              class={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight transition-all ${(rightOpen() && isSoloOpen()) ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-zinc-400 border border-white/5'
                }`}
            >
              <LayoutIcon size={12} />
              <span>MultiX</span>
            </button>
            <IconButton
              ref={setRightToggleButtonEl}
              color="inherit"
              onClick={handleRightAppBarButtonClick}
              aria-label={rightAppBarButtonLabel()}
              size="small"
              class="text-zinc-500 hover:text-zinc-200"
            >
              {rightAppBarButtonIcon()}
            </IconButton>
          </div>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0, width: "100%", overflow: "hidden", position: "relative", zIndex: 10 }}>
        {renderLeftPanel()}

        <Box
          component="div"
          sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          class="content-area relative bg-[#050505]"
        >
          {/* Main workspace area */}
          <div class="flex-1 flex flex-row min-h-0 w-full overflow-hidden">
            {/* Center Area (Editor/Preview) */}
            <div class="flex-1 flex flex-col min-h-0 bg-[#0d0d0d] overflow-hidden">
              <div class="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#111112]">
                <div class="flex items-center space-x-4">
                  <button
                    onClick={() => setCenterTab("code")}
                    class={`px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${centerTab() === "code"
                      ? "bg-white/10 border-white/20 text-white"
                      : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      }`}
                  >
                    Code
                  </button>
                  <button
                    onClick={() => setCenterTab("preview")}
                    class={`px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${centerTab() === "preview"
                      ? "bg-white/10 border-white/20 text-white"
                      : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      }`}
                  >
                    Preview
                  </button>
                </div>
                <Show when={previewUrl()}>
                  {(url) => (
                    <div class="text-[10px] text-zinc-500 truncate max-w-[50%]" title={url()}>
                      {url()}
                    </div>
                  )}
                </Show>
              </div>

              <Show when={centerTab() === "preview"} fallback={<Editor file={currentFile()} />}>
                <div class="flex-1 min-h-0 bg-white">
                  <iframe
                    src={previewUrl() || "about:blank"}
                    class="w-full h-full border-none"
                    title="Preview"
                  />
                </div>
              </Show>
            </div>

            {/* Right Panel (MultiX Chat) */}
            <Show when={rightOpen() && isSoloOpen()}>
              <div class="flex flex-col relative border-l border-white/5 min-h-0 overflow-hidden" style={{ width: `${chatPanelWidth()}px`, "flex-shrink": 0 }}>
                <MultiTaskChat instanceId={props.instance.id} sessionId={activeSessionIdForInstance()!} />
              </div>
            </Show>
          </div>

          <div
            class="flex flex-col border-t border-white/5 relative bg-[#09090b] z-10 shrink-0 overflow-hidden"
            style={{
              height: terminalOpen() ? `${terminalPanelHeight()}px` : "32px",
              transition: activeResizeSide() === 'terminal' ? 'none' : 'height 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <Show when={terminalOpen()}>
              <div
                class="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-20 hover:bg-white/5 active:bg-white/10 transition-colors"
                onMouseDown={handleResizeMouseDown("terminal")}
              />
              <div class="flex-1 min-h-0 overflow-hidden p-4 bg-[#0d0d0d]">
                <div class="font-mono text-xs text-zinc-400">
                  <div class="mb-2 text-zinc-600">// Terminal functionality coming soon</div>
                  <div class="text-emerald-500/80 flex items-center gap-2">
                    <span>➜</span>
                    <span>~</span>
                    <span class="animate-pulse">_</span>
                  </div>
                </div>
              </div>
            </Show>

            <footer class="h-8 flex items-center justify-between px-3 text-[10px] text-zinc-500 tracking-wide shrink-0 border-t border-white/5 bg-[#09090b]">
              <div class="flex items-center space-x-4">
                <button
                  class={`flex items-center space-x-1.5 cursor-pointer hover:text-zinc-300 transition-colors outline-none ${terminalOpen() ? 'text-indigo-400 font-bold' : ''}`}
                  onClick={() => setTerminalOpen(!terminalOpen())}
                >
                  <TerminalIcon size={12} />
                  <span>TERMINAL</span>
                </button>
              </div>
              <div class="flex items-center space-x-4 uppercase font-bold">
                <div class="flex items-center space-x-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                  <span>Sync Active</span>
                </div>
              </div>
            </footer>
          </div>
        </Box>
        {renderRightPanel()}
      </Box>
    </div>
  )

  return (
    <>
      <div class="instance-shell2 flex flex-col flex-1 min-h-0">
        <Show when={hasSessions()} fallback={<InstanceWelcomeView instance={props.instance} />}>
          {sessionLayout}
        </Show>
      </div>

      <CommandPalette
        open={paletteOpen()}
        onClose={() => hideCommandPalette(props.instance.id)}
        commands={instancePaletteCommands()}
        onExecute={props.onExecuteCommand}
      />
      <AdvancedSettingsModal
        open={showAdvancedSettings()}
        onClose={() => setShowAdvancedSettings(false)}
        selectedBinary={selectedBinary()}
        onBinaryChange={(binary) => setSelectedBinary(binary)}
      />
    </>
  )
}

export default InstanceShell2
