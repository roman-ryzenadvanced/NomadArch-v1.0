import { createSignal, Show, onMount, For, createMemo, createEffect, onCleanup, untrack } from "solid-js";
import { sessions, withSession, setActiveSession } from "@/stores/session-state";
import { instances } from "@/stores/instances";
import { sendMessage, compactSession, updateSessionAgent, updateSessionModelForSession, forceReset } from "@/stores/session-actions";
import { addTask, setActiveTask, archiveTask } from "@/stores/task-actions";
import { messageStoreBus } from "@/stores/message-v2/bus";
import MessageBlockList, { getMessageAnchorId } from "@/components/message-block-list";
import { formatTokenTotal } from "@/lib/formatters";
import { addToTaskQueue, getSoloState, setActiveTaskId, toggleAutonomous, toggleAutoApproval, toggleApex } from "@/stores/solo-store";
import { getLogger } from "@/lib/logger";
import { clearCompactionSuggestion, getCompactionSuggestion } from "@/stores/session-compaction";
import { emitSessionSidebarRequest } from "@/lib/session-sidebar-events";
import {
  Command,
  Plus,
  CheckCircle2,
  PanelRight,
  ListTodo,
  AtSign,
  Hash,
  Mic,
  ArrowUp,
  Terminal,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  Zap,
  Layers,
  Shield,
  Activity,
  Square,
  Clock,
  Sparkles,
  StopCircle,
  Bot,
  User,
  Settings,
  Key,
  FileArchive,
  Paperclip,
} from "lucide-solid";
import ModelSelector from "@/components/model-selector";
import AgentSelector from "@/components/agent-selector";
import { DebugOverlay, setForceResetFn } from "@/components/debug-overlay";
import AttachmentChip from "@/components/attachment-chip";
import { createFileAttachment } from "@/types/attachment";
import type { InstanceMessageStore } from "@/stores/message-v2/instance-store";
import type { Task } from "@/types/session";

const OPEN_ADVANCED_SETTINGS_EVENT = "open-advanced-settings";

const log = getLogger("multix-chat");

interface MultiTaskChatProps {
  instanceId: string;
  sessionId: string;
}

export default function MultiTaskChat(props: MultiTaskChatProps) {
  const selectedTaskId = () => session()?.activeTaskId || null;
  const setSelectedTaskId = (id: string | null) => setActiveTask(props.instanceId, props.sessionId, id || undefined);
  const [isSending, setIsSending] = createSignal(false);
  const [chatInput, setChatInput] = createSignal("");
  const [isCompacting, setIsCompacting] = createSignal(false);
  const [attachments, setAttachments] = createSignal<ReturnType<typeof createFileAttachment>[]>([]);
  let scrollContainer: HTMLDivElement | undefined;
  const [bottomSentinel, setBottomSentinel] = createSignal<HTMLDivElement | null>(null);
  const [userScrolling, setUserScrolling] = createSignal(false);
  const [lastScrollTop, setLastScrollTop] = createSignal(0);
  let fileInputRef: HTMLInputElement | undefined;

  // Scroll to bottom helper
  const scrollToBottom = () => {
    if (scrollContainer && !userScrolling()) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  };

  // Track if user is manually scrolling (not at bottom)
  const checkUserScrolling = () => {
    if (!scrollContainer) return false;
    const threshold = 50;
    const isAtBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < threshold;
    return !isAtBottom;
  };

  // Get current session and tasks
  const session = () => {
    const instanceSessions = sessions().get(props.instanceId);
    return instanceSessions?.get(props.sessionId);
  };

  const tasks = () => session()?.tasks || [];
  const visibleTasks = createMemo(() => tasks().filter((task) => !task.archived));
  const selectedTask = () => visibleTasks().find((task) => task.id === selectedTaskId());

  // Message store integration
  const messageStore = () => messageStoreBus.getOrCreate(props.instanceId);

  // Filter messages based on selected task - use store's session messages for the task session
  // Must be defined before lastAssistantIndex which depends on it
  const filteredMessageIds = createMemo(() => {
    const task = selectedTask();
    if (!task) return []; // Show no messages in Pipeline view

    // If task has a dedicated session, get messages from the store for that session
    if (task.taskSessionId) {
      const store = messageStore();
      return store.getSessionMessageIds(task.taskSessionId);
    }

    // Fallback to task.messageIds for backward compatibility
    return task.messageIds || [];
  });

  // Memoized to prevent recalculation on every render
  const lastAssistantIndex = createMemo(() => {
    const ids = filteredMessageIds();
    if (ids.length === 0) return -1;

    const store = messageStore();
    // Only check last few messages to find the last assistant (optimization)
    const startIndex = Math.max(0, ids.length - 5);
    for (let i = ids.length - 1; i >= startIndex; i--) {
      const msg = store.getMessage(ids[i]);
      if (msg?.role === "assistant") return i;
    }
    // If not found in last 5, fall back to full scan (rare case)
    for (let i = startIndex - 1; i >= 0; i--) {
      const msg = store.getMessage(ids[i]);
      if (msg?.role === "assistant") return i;
    }
    return -1;
  });

  // Note: Auto-scroll is handled in two places:
  // 1. After sending a message (in handleSendMessage)
  // 2. During streaming (in the isAgentThinking effect below)
  // We intentionally don't scroll on message count change to let users scroll freely

  // Token and status tracking
  const sessionUsage = createMemo(() => {
    const store = messageStore();
    return store.getSessionUsage(props.sessionId);
  });

  const tokenStats = createMemo(() => {
    return untrack(() => {
      const usage = sessionUsage();
      return {
        used: usage?.actualUsageTokens ?? 0,
        total: usage?.totalCost ?? 0,
        // input: usage?.inputTokens ?? 0,
        // output: usage?.outputTokens ?? 0,
        // reasoning: usage?.reasoningTokens ?? 0,
        // cacheRead: usage?.cacheReadTokens ?? 0,
        // cacheWrite: usage?.cacheWriteTokens ?? 0,
        cost: usage?.totalCost ?? 0,
      };
    });
  });

  // Get active task session ID (must be defined before memos that use it)
  const activeTaskSessionId = createMemo(() => {
    const task = selectedTask();
    return task?.taskSessionId || props.sessionId;
  });

  const activeTaskSession = createMemo(() => {
    const instanceSessions = sessions().get(props.instanceId);
    return instanceSessions?.get(activeTaskSessionId());
  });

  // Get current model from active task session
  const currentModel = createMemo(() => {
    const instanceSessions = sessions().get(props.instanceId);
    const session = instanceSessions?.get(activeTaskSessionId());
    return session?.model?.modelId || "unknown";
  });

  const currentTaskAgent = createMemo(() => activeTaskSession()?.agent || "");
  const currentTaskModel = createMemo(() => activeTaskSession()?.model || { providerId: "", modelId: "" });

  const compactionSuggestion = createMemo(() => {
    const sessionId = activeTaskSessionId();
    return getCompactionSuggestion(props.instanceId, sessionId);
  });

  const hasCompactionSuggestion = createMemo(() => Boolean(compactionSuggestion()));

  const solo = () => getSoloState(props.instanceId);

  // APEX PRO mode = SOLO + APEX combined (autonomous + auto-approval)
  const isApexPro = () => solo().isAutonomous && solo().autoApproval;

  const toggleApexPro = () => {
    const currentState = isApexPro();
    if (currentState) {
      // Turn off both
      if (solo().isAutonomous) toggleAutonomous(props.instanceId);
      if (solo().autoApproval) toggleAutoApproval(props.instanceId);
    } else {
      // Turn on both
      if (!solo().isAutonomous) toggleAutonomous(props.instanceId);
      if (!solo().autoApproval) toggleAutoApproval(props.instanceId);
    }
  };

  const isAgentThinking = createMemo(() => {
    // Show thinking while we're actively sending
    if (isSending()) return true;

    const ids = filteredMessageIds();
    if (ids.length === 0) return false;

    const store = messageStore();
    const lastMsg = store.getMessage(ids[ids.length - 1]);
    return lastMsg?.role === "assistant" && (lastMsg.status === "streaming" || lastMsg.status === "sending");
  });

  // Auto-scroll during streaming - DISABLED for performance testing
  // createEffect(() => {
  //   const streaming = isAgentThinking();
  //   if (!streaming) return;
  //
  //   let lastScrollTime = 0;
  //   const scrollThrottled = () => {
  //     const now = Date.now();
  //     if (now - lastScrollTime > 500) {
  //       lastScrollTime = now;
  //       if (!userScrolling()) {
  //         scrollToBottom();
  //       }
  //     }
  //   };
  //
  //   const interval = setInterval(() => {
  //     if (!userScrolling()) {
  //       requestAnimationFrame(scrollToBottom);
  //     }
  //   }, 200);
  //   return () => clearInterval(interval);
  // });

  // Auto-scroll when new messages arrive (throttled to count changes only)
  let lastScrolledCount = 0;
  let scrollTimeoutId: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const ids = filteredMessageIds();
    const count = ids.length;

    // Only scroll when message COUNT changes, not on every store update
    // This prevents the effect from firing on every streaming chunk
    // Note: Streaming scrolling is handled by the interval in the isAgentThinking effect above
    if (count !== lastScrolledCount && count > 0 && !userScrolling()) {
      lastScrolledCount = count;

      // Clear any existing timeout to prevent timer accumulation
      if (scrollTimeoutId) {
        clearTimeout(scrollTimeoutId);
      }

      // Use requestAnimationFrame for smoother scrolling without locking specific frames
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  });

  // Scroll event listener to detect user scrolling
  onMount(() => {
    // Wire up debug overlay reset function (must be inside onMount to avoid SolidJS errors)
    setForceResetFn(() => {
      forceReset();
      setIsSending(false);
    });

    const handleScroll = () => {
      if (scrollContainer) {
        const isScrollingUp = scrollContainer.scrollTop < lastScrollTop();
        const isScrollingDown = scrollContainer.scrollTop > lastScrollTop();
        setLastScrollTop(scrollContainer.scrollTop);

        // If user scrolls up or scrolls away from bottom, set userScrolling flag
        if (checkUserScrolling()) {
          setUserScrolling(true);
        } else {
          // User is back at bottom, reset the flag
          setUserScrolling(false);
        }
      }
    };

    const container = scrollContainer;
    container?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      // Enhanced cleanup: remove scroll listener and clear any pending timeouts
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
      // Clear any pending scroll timeout
      if (scrollTimeoutId) {
        clearTimeout(scrollTimeoutId);
      }
    };
  });

  // Additional cleanup on component unmount
  onCleanup(() => {
    if (scrollTimeoutId) {
      clearTimeout(scrollTimeoutId);
    }
  });

  const handleSendMessage = async () => {
    const message = chatInput().trim();
    if (!message || isSending()) return;

    setIsSending(true);

    // Yield to let UI update "Is Sending" state before heavy operations
    await new Promise(resolve => setTimeout(resolve, 0));

    // Reduced logging to prevent IPC overload
    // log.info("handleSendMessage started", { ... });
    try {
      let taskId = selectedTaskId();
      let targetSessionId = props.sessionId;

      // If no task selected, create one automatically
      if (!taskId) {
        // log.info("No task selected, creating new task");
        const title = message.length > 30 ? message.substring(0, 27) + "..." : message;
        const result = await addTask(props.instanceId, props.sessionId, title);
        taskId = result.id;
        targetSessionId = result.taskSessionId || props.sessionId;

        // log.info("New task created", { taskId, targetSessionId });
        setSelectedTaskId(taskId);

        // If autonomous mode is on, we might want to queue it or set it as active
        const s = solo();
        if (s.isAutonomous) {
          // log.info("Autonomous mode active, setting active task or queuing");
          if (!s.activeTaskId) {
            setActiveTaskId(props.instanceId, taskId);
          } else {
            addToTaskQueue(props.instanceId, taskId);
          }
        }
      } else {
        const task = selectedTask();
        targetSessionId = task?.taskSessionId || props.sessionId;
      }

      // log.info("Target session identified", { targetSessionId, taskId });

      const store = messageStore();
      /* log.info("Message store check before sending", {
        instanceId: props.instanceId,
        storeExists: !!store,
        messageCount: store?.getSessionMessageIds(targetSessionId).length
      }); */

      await sendMessage(
        props.instanceId,
        targetSessionId,
        message,
        attachments(),
        taskId || undefined
      );

      // log.info("sendMessage call completed");
      setChatInput("");
      setAttachments([]);

      // Auto-scroll to bottom after sending
      setTimeout(scrollToBottom, 100);
    } catch (error) {
      // log.error("handleSendMessage failed", error);
      console.error("[MultiTaskChat] Send failed:", error);
    } finally {
      setIsSending(false);
      // log.info("handleSendMessage finished");
    }
  };

  const handleCreateTask = async () => {
    if (isSending()) return;
    setChatInput("");
    try {
      const nextIndex = tasks().length + 1;
      const title = `Task ${nextIndex}`;
      const result = await addTask(props.instanceId, props.sessionId, title);
      setSelectedTaskId(result.id);
      setTimeout(scrollToBottom, 50);
    } catch (error) {
      log.error("handleCreateTask failed", error);
      console.error("[MultiTaskChat] Task creation failed:", error);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Enter to submit, Shift+Enter for new line
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Stop/cancel the current agent operation
  const handleStopAgent = async (e?: MouseEvent) => {
    // Check for Force Reset (Shift + Click)
    if (e?.shiftKey) {
      log.warn("Shift+Click detected on Stop Agent - Triggering Force Reset");
      forceReset();
      setIsSending(false);
      return;
    }

    const task = selectedTask();
    if (!task) return;

    log.info("Stopping agent for task:", task.id);
    // Send interrupt signal via the session API
    try {
      const targetSessionId = task.taskSessionId || props.sessionId;
      // Use the cancel endpoint or interrupt mechanism
      await fetch(`/api/workspaces/${props.instanceId}/sessions/${targetSessionId}/cancel`, {
        method: "POST",
      });
      log.info("Agent stopped successfully");
    } catch (error) {
      log.error("Failed to stop agent:", error);
    }
  };

  const handleOpenAdvancedSettings = () => {
    // Dispatch custom event to trigger Advanced Settings modal from parent
    window.dispatchEvent(new CustomEvent(OPEN_ADVANCED_SETTINGS_EVENT, {
      detail: { instanceId: props.instanceId, sessionId: props.sessionId }
    }));
  };

  const handleCompact = async () => {
    const targetSessionId = activeTaskSessionId();
    if (isCompacting()) return;

    setIsCompacting(true);
    log.info("Compacting session", { instanceId: props.instanceId, sessionId: targetSessionId });

    try {
      clearCompactionSuggestion(props.instanceId, targetSessionId);
      await compactSession(props.instanceId, targetSessionId);
      log.info("Session compacted successfully");
    } catch (error) {
      log.error("Failed to compact session", error);
      console.error("[MultiTaskChat] Compact failed:", error);
    } finally {
      setIsCompacting(false);
      log.info("Compact operation finished");
    }
  };

  const addAttachment = (attachment: ReturnType<typeof createFileAttachment>) => {
    setAttachments((prev) => [...prev, attachment]);
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleFileSelect = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    Array.from(input.files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result instanceof ArrayBuffer ? reader.result : null;
        const data = buffer ? new Uint8Array(buffer) : undefined;
        const attachment = createFileAttachment(file.name, file.name, file.type || "application/octet-stream", data);
        if (file.type.startsWith("image/") && typeof reader.result === "string") {
          attachment.url = reader.result;
        }
        addAttachment(attachment);
      };
      reader.readAsArrayBuffer(file);
    });

    input.value = "";
  };

  return (
    <main class="absolute inset-0 flex flex-col bg-[#0a0a0b] text-zinc-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
      <DebugOverlay />
      {/* Header */}
      <header class="h-14 px-4 flex items-center justify-between bg-zinc-900/60 backdrop-blur-xl border-b border-white/5 relative z-30 shrink-0">
        <div class="flex items-center space-x-3">
          <div class="flex items-center bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-2.5 py-1.5 shadow-[0_0_20px_rgba(99,102,241,0.1)]">
            <span class="text-[10px] font-black text-indigo-400 mr-2.5 tracking-tighter uppercase">MULTIX</span>
            <div class="bg-indigo-500 rounded-md w-4 h-4 flex items-center justify-center shadow-lg shadow-indigo-500/40">
              <Zap size={10} class="text-white fill-current" />
            </div>
          </div>
          <button
            onClick={() => emitSessionSidebarRequest({ instanceId: props.instanceId, action: "show-skills" })}
            class="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-indigo-500/10 transition-all"
            title="Open Skills"
          >
            <Sparkles size={12} class="text-indigo-400" />
            <span class="text-[10px] font-black uppercase tracking-tight">Skills</span>
          </button>

          <Show when={selectedTaskId()}>
            <div class="flex items-center space-x-2 animate-in fade-in slide-in-from-left-2 duration-300">
              <ChevronRight size={14} class="text-zinc-600" />
              <div class="flex items-center space-x-2 px-2.5 py-1 bg-white/5 rounded-lg border border-white/5">
                <ListTodo size={14} class="text-indigo-400" />
                <span class="text-[11px] font-bold text-zinc-100 truncate max-w-[120px]">
                  {selectedTask()?.title || "Active Task"}
                </span>
                <button
                  onClick={() => setSelectedTaskId(null)}
                  class="ml-1 p-0.5 hover:bg-white/10 rounded-md transition-colors text-zinc-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          </Show>
        </div>

        <div class="flex items-center space-x-2">
          {/* STREAMING indicator */}
          <Show when={isAgentThinking()}>
            <div class="flex items-center space-x-2 px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 rounded-lg animate-pulse shadow-[0_0_20px_rgba(139,92,246,0.2)]">
              <Sparkles size={12} class="text-violet-400 animate-spin" style={{ "animation-duration": "3s" }} />
              <span class="text-[10px] font-black text-violet-400 uppercase tracking-tight">Streaming</span>
              <span class="text-[10px] font-bold text-violet-300">{formatTokenTotal(tokenStats().used)}</span>
            </div>
          </Show>

          {/* Task status badge */}
          <Show when={selectedTask()}>
            <div class={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tight border ${selectedTask()?.status === "completed"
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              : selectedTask()?.status === "in-progress"
                ? "bg-indigo-500/15 border-indigo-500/30 text-indigo-400"
                : "bg-amber-500/15 border-amber-500/30 text-amber-400"
              }`}>
              {selectedTask()?.status === "completed" ? "DONE" : selectedTask()?.status === "in-progress" ? "RUNNING" : "PENDING"}
            </div>
          </Show>

          {/* Compact Button - Context Compression & Summary */}
          <button
            onClick={handleCompact}
            class={`flex items-center space-x-1.5 px-2.5 py-1.5 transition-all rounded-xl active:scale-95 border ${isCompacting()
              ? "text-blue-400 bg-blue-500/15 border-blue-500/40 animate-pulse shadow-[0_0_20px_rgba(59,130,246,0.3)]"
              : hasCompactionSuggestion()
                ? "text-emerald-300 bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_16px_rgba(34,197,94,0.35)] animate-pulse"
                : "text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 border-transparent hover:border-blue-500/30"
              }`}
            title={isCompacting() ? "Compacting session (compressing context & creating summary)..." : "Compact session - Compress context & create summary"}
            disabled={isCompacting()}
          >
            <FileArchive size={16} strokeWidth={2} />
            <span class="text-[10px] font-bold uppercase tracking-tight">{isCompacting() ? "Compacting..." : "Compact"}</span>
          </button>

          {/* API Key Manager Button - Opens Advanced Settings */}
          <button
            onClick={handleOpenAdvancedSettings}
            class="p-2 text-zinc-500 hover:text-emerald-400 transition-all hover:bg-emerald-500/10 rounded-xl active:scale-90"
            title="API Key Manager"
          >
            <Key size={18} strokeWidth={2} />
          </button>
          <button class="p-2 text-zinc-500 hover:text-white transition-all hover:bg-white/5 rounded-xl active:scale-90">
            <Command size={18} strokeWidth={2} />
          </button>
          <button class="p-2 text-zinc-500 hover:text-white transition-all hover:bg-white/5 rounded-xl active:scale-90">
            <PanelRight size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Task Tabs (Horizontal Scroll) */}
      <Show when={visibleTasks().length > 0}>
        <div class="flex items-center bg-[#0a0a0b] border-b border-white/5 px-2 py-2 space-x-1.5 overflow-x-auto custom-scrollbar-hidden no-scrollbar shrink-0">
          <button
            onClick={() => setSelectedTaskId(null)}
            class={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0 border ${!selectedTaskId()
              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5 border-transparent"
              }`}
          >
            <Layers size={12} class={!selectedTaskId() ? "text-indigo-400" : "text-zinc-600"} />
            <span>Pipeline</span>
          </button>

          <div class="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

          <div class="flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
            <For each={visibleTasks()}>
              {(task) => (
                <button
                  onClick={() => setSelectedTaskId(task.id)}
                  class={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-[10px] font-bold transition-all shrink-0 max-w-[160px] border group ${selectedTaskId() === task.id
                    ? "bg-white/10 text-zinc-100 border-white/20 shadow-xl shadow-black/20"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5 border-transparent"
                    }`}
                >
                  <div class={`w-2 h-2 rounded-full transition-all duration-500 ${task.status === "completed" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" :
                    task.status === "interrupted" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" :
                      "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)] animate-pulse"
                    }`} />
                  <span class="truncate">{task.title}</span>
                  <span
                    role="button"
                    tabindex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      archiveTask(props.instanceId, props.sessionId, task.id);
                    }}
                    class="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-200 transition-colors"
                    title="Archive task"
                  >
                    <X size={12} />
                  </span>
                  <Show when={selectedTaskId() === task.id}>
                    <div class="ml-1 w-1 h-1 bg-indigo-400 rounded-full animate-ping" />
                  </Show>
                </button>
              )}
            </For>
          </div>

          <button
            onClick={() => {
              handleCreateTask();
            }}
            class="flex items-center justify-center w-8 h-8 rounded-xl text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all shrink-0 ml-1 border border-transparent hover:border-indigo-500/20"
            title="New Task"
          >
            <Plus size={16} strokeWidth={3} />
          </button>
        </div>
      </Show>

      <Show when={selectedTask()}>
        <div class="px-4 py-3 border-b border-white/5 bg-zinc-950/40">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <AgentSelector
              instanceId={props.instanceId}
              sessionId={activeTaskSessionId()}
              currentAgent={currentTaskAgent()}
              onAgentChange={(agent) => updateSessionAgent(props.instanceId, activeTaskSessionId(), agent)}
            />
            <ModelSelector
              instanceId={props.instanceId}
              sessionId={activeTaskSessionId()}
              currentModel={currentTaskModel()}
              onModelChange={(model) => updateSessionModelForSession(props.instanceId, activeTaskSessionId(), model)}
            />
          </div>
        </div>
      </Show>

      {/* Main Content Area - min-h-0 is critical for flex containers with overflow */}
      <div class="flex-1 min-h-0 relative overflow-hidden flex">
        {/* Main chat area */}
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div
            ref={scrollContainer}
            class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar"
          >
            <Show when={hasCompactionSuggestion()}>
              <div class="mx-3 mt-3 mb-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 flex items-center justify-between gap-3">
                <span class="font-semibold">Compact suggested: {compactionSuggestion()?.reason}</span>
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 transition-colors"
                  onClick={handleCompact}
                >
                  Compact now
                </button>
              </div>
            </Show>
            <Show when={!selectedTaskId()} fallback={
              <div class="p-3 pb-4 overflow-x-hidden">
                <MessageBlockList
                  instanceId={props.instanceId}
                  sessionId={activeTaskSessionId()}
                  store={messageStore}
                  messageIds={filteredMessageIds}
                  lastAssistantIndex={lastAssistantIndex}
                  showThinking={() => true}
                  thinkingDefaultExpanded={() => true}
                  showUsageMetrics={() => true}
                  scrollContainer={() => scrollContainer}
                  setBottomSentinel={setBottomSentinel}
                />
              </div>
            }>
              {/* Pipeline View */}
              <div class="p-4 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div class="space-y-2">
                  <h2 class="text-2xl font-black text-white tracking-tight leading-none">Pipeline</h2>
                  <p class="text-xs font-medium text-zinc-500 uppercase tracking-[0.2em]">Agentic Orchestration</p>
                </div>

                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Active Threads</span>
                    <div class="h-px flex-1 bg-white/5 mx-4" />
                    <span class="text-[10px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                      {visibleTasks().length}
                    </span>
                  </div>

                  <div class="grid gap-3">
                    <For each={visibleTasks()} fallback={
                      <div class="group relative p-8 rounded-3xl border border-dashed border-white/5 bg-zinc-900/20 flex flex-col items-center justify-center text-center space-y-4 transition-all hover:bg-zinc-900/40 hover:border-white/10">
                        <div class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-zinc-600 group-hover:text-indigo-400 group-hover:scale-110 transition-all duration-500">
                          <Plus size={24} strokeWidth={1.5} />
                        </div>
                        <div class="space-y-1">
                          <p class="text-sm font-bold text-zinc-400">No active tasks</p>
                          <p class="text-[11px] text-zinc-600">Send a message below to start a new thread</p>
                        </div>
                      </div>
                    }>
                      {(task) => (
                        <button
                          onClick={() => setSelectedTaskId(task.id)}
                          class="group relative p-4 rounded-2xl border border-white/5 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-indigo-500/30 transition-all duration-300 text-left flex items-start space-x-4 active:scale-[0.98]"
                        >
                          <div class={`mt-1 w-2 h-2 rounded-full shadow-[0_0_10px_rgba(var(--color),0.5)] ${task.status === "completed" ? "bg-emerald-500 shadow-emerald-500/40" :
                            task.status === "in-progress" ? "bg-indigo-500 shadow-indigo-500/40 animate-pulse" :
                              "bg-zinc-600 shadow-zinc-600/20"
                            }`} />
                          <div class="flex-1 min-w-0 space-y-1">
                            <p class="text-sm font-bold text-zinc-100 truncate group-hover:text-white transition-colors">
                              {task.title}
                            </p>
                            <div class="flex items-center space-x-3 text-[10px] font-bold text-zinc-500 uppercase tracking-tight">
                              <span>{new Date(task.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span class="w-1 h-1 rounded-full bg-zinc-800" />
                              <span>{task.messageIds?.length || 0} messages</span>
                            </div>
                          </div>
                          <div class="flex items-center space-x-2">
                            <span
                              role="button"
                              tabindex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                archiveTask(props.instanceId, props.sessionId, task.id);
                              }}
                              class="text-zinc-600 hover:text-zinc-200 transition-colors"
                              title="Archive task"
                            >
                              <X size={14} />
                            </span>
                            <ChevronRight size={16} class="text-zinc-700 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Chat Input Area - Fixed at bottom */}
          <div class="p-3 bg-[#0a0a0b] border-t border-white/5 shrink-0">
            <div class="w-full bg-zinc-900/80 border border-white/10 rounded-2xl shadow-lg p-3">
              {/* Header Row */}
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-2">
                  <div class="w-5 h-5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                    <AtSign size={10} class="text-white" strokeWidth={3} />
                  </div>
                  <div class="flex flex-col">
                    <span class="text-[10px] font-bold text-zinc-100 uppercase tracking-wide">
                      {selectedTaskId() ? "Task Context" : "Global Pipeline"}
                    </span>
                    <span class="text-[9px] text-zinc-500 uppercase">
                      {selectedTaskId() ? "MultiX Threaded" : "Auto-Task"}
                    </span>
                  </div>
                </div>

                <div class="flex items-center space-x-2">
                  <button
                    onClick={() => toggleApex(props.instanceId)}
                    title="Toggle APEX Mode (Max Priority)"
                    class={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border transition-all ${solo().isApex
                      ? "bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                      : "bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10"
                      }`}
                  >
                    <Zap size={10} class={solo().isApex ? "animate-bounce" : ""} />
                    <span class="text-[9px] font-black uppercase tracking-tighter">Apex</span>
                  </button>
                  <button
                    onClick={toggleApexPro}
                    class={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-tight border transition-all ${isApexPro()
                      ? "bg-orange-500/20 border-orange-500/40 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.3)]"
                      : "bg-white/5 border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-400"
                      }`}
                    title="APEX PRO - Autonomous Programming EXecution + Auto-approval combined"
                    style={isApexPro() ? { animation: "apex-pro-pulse 2s ease-in-out infinite" } : {}}
                  >
                    <Zap size={12} class={isApexPro() ? "text-orange-400" : ""} />
                    <span>APEX PRO</span>
                    <Show when={isApexPro()}>
                      <div class="w-1.5 h-1.5 bg-orange-400 rounded-full" style={{ animation: "apex-pro-glow 1.5s ease-in-out infinite" }} />
                    </Show>
                  </button>
                  <button
                    onClick={() => toggleAutoApproval(props.instanceId)}
                    class={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${solo().autoApproval
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                      : "bg-white/5 border-white/10 text-zinc-500"
                      }`}
                    title="SHIELD - Auto-approval mode only"
                  >
                    SHIELD
                  </button>
                  <Show when={tokenStats().used > 0}>
                    <div class="px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/20 text-[9px] font-bold text-emerald-400">
                      {formatTokenTotal(tokenStats().used)}
                    </div>
                  </Show>
                  <Show when={isSending() || isAgentThinking()}>
                    <div class="flex items-center space-x-1 px-2 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                      <div class="flex space-x-0.5">
                        <div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                        <div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                        <div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
                      </div>
                      <span class="text-[9px] font-bold text-indigo-400">{isAgentThinking() ? "THINKING" : "SENDING"}</span>
                    </div>
                  </Show>
                </div>
              </div>

              <Show when={attachments().length > 0}>
                <div class="flex flex-wrap gap-2 mb-2">
                  <For each={attachments()}>
                    {(attachment) => (
                      <AttachmentChip
                        attachment={attachment}
                        onRemove={() => removeAttachment(attachment.id)}
                      />
                    )}
                  </For>
                </div>
              </Show>

              {/* Text Input */}
              <textarea
                value={chatInput()}
                onInput={(e) => setChatInput(e.currentTarget.value)}
                placeholder={selectedTaskId() ? "Send instruction to this task..." : "Type to create a new task and begin..."}
                class="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[13px] text-zinc-100 placeholder-zinc-600 resize-none min-h-[40px] max-h-32 leading-relaxed disabled:opacity-50"
                onKeyDown={handleKeyDown}
                disabled={isSending()}
                rows={1}
              />

              {/* Footer Row */}
              <div class="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                  {/* Detailed token stats */}
                  {/* Detailed breakdown not available */}
                  <div class="flex items-center space-x-1.5">
                    <span class="text-[8px] font-bold text-zinc-600 uppercase">COST</span>
                    <span class="text-[9px] font-bold text-violet-400">${tokenStats().cost.toFixed(4)}</span>
                  </div>
                  <div class="w-px h-3 bg-zinc-800" />
                  <div class="flex items-center space-x-1.5">
                    <span class="text-[8px] font-bold text-zinc-600 uppercase">MODEL</span>
                    <span class="text-[9px] font-bold text-indigo-400">{currentModel()}</span>
                  </div>
                  <div class="flex items-center space-x-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      class="sr-only"
                      onChange={handleFileSelect}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef?.click()}
                      class="text-zinc-600 hover:text-indigo-300 transition-colors p-1"
                      title="Attach files"
                    >
                      <Paperclip size={14} />
                    </button>
                    <button class="text-zinc-600 hover:text-zinc-400 transition-colors p-1">
                      <Hash size={14} />
                    </button>
                    <button class="text-zinc-600 hover:text-zinc-400 transition-colors p-1">
                      <Mic size={14} />
                    </button>
                    <div class="w-px h-3 bg-zinc-800" />
                    <div class="flex items-center space-x-1 text-zinc-600">
                      <kbd class="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-bold border border-white/5">ENTER</kbd>
                      <span class="text-[9px]">to send</span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center space-x-2">
                  <Show when={isAgentThinking() || isSending()}>
                    <button
                      onClick={handleStopAgent}
                      class="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all border border-rose-500/30"
                      title="Stop response (Shift+Click to Force Reset UI)"
                    >
                      <StopCircle size={12} class="inline-block mr-1" />
                      Stop
                    </button>
                  </Show>
                  <button
                    onClick={handleSendMessage}
                    disabled={!chatInput().trim() || isSending()}
                    class="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-[11px] font-bold uppercase tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center space-x-1.5"
                  >
                    <Show when={isSending()} fallback={
                      <>
                        <span>{selectedTaskId() ? "Update Task" : "Launch Task"}</span>
                        <ArrowUp size={12} strokeWidth={3} />
                      </>
                    }>
                      <Loader2 size={12} class="animate-spin" />
                    </Show>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Message Navigation Sidebar - YOU/ASST labels with hover preview */}
        <Show when={selectedTaskId() && filteredMessageIds().length > 0}>
          <div class="w-14 shrink-0 bg-zinc-900/40 border-l border-white/5 overflow-hidden py-2 px-1.5 flex flex-col items-center gap-1">
            <For each={filteredMessageIds()}>
              {(messageId, index) => {
                const msg = () => messageStore().getMessage(messageId);
                const isUser = () => msg()?.role === "user";
                const [showPreview, setShowPreview] = createSignal(false);

                // Get message preview text (first 150 chars)
                const previewText = () => {
                  const message = msg();
                  if (!message) return "";
                  const content = (message.parts?.[0] as any)?.text || (message.parts?.[0] as any)?.content || (message as any).content || "";
                  const text = typeof content === "string" ? content : JSON.stringify(content);
                  return text.length > 150 ? text.substring(0, 150) + "..." : text;
                };

                const handleTabClick = () => {
                  const anchorId = getMessageAnchorId(messageId);
                  const element = scrollContainer?.querySelector(`#${anchorId}`);
                  if (element) {
                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                    // Highlight the message briefly
                    element.classList.add("message-highlight");
                    setTimeout(() => element.classList.remove("message-highlight"), 2000);
                  }
                };

                return (
                  <div class="relative group">
                    <button
                      onClick={handleTabClick}
                      onMouseEnter={() => setShowPreview(true)}
                      onMouseLeave={() => setShowPreview(false)}
                      class={`w-10 py-1.5 rounded text-[8px] font-black uppercase transition-all cursor-pointer ${isUser()
                        ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/40 hover:scale-105"
                        : "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/40 hover:scale-105"
                        }`}
                    >
                      {isUser() ? "YOU" : "ASST"}
                    </button>

                    {/* Hover Preview Tooltip */}
                    <Show when={showPreview()}>
                      <div class="absolute right-full mr-2 top-0 w-72 max-h-40 overflow-y-auto bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-3 z-50 animate-in fade-in slide-in-from-right-2 duration-150 custom-scrollbar">
                        <div class="flex items-center justify-between mb-2">
                          <div class={`text-[9px] font-bold uppercase ${isUser() ? "text-indigo-400" : "text-emerald-400"}`}>
                            {isUser() ? "You" : "Assistant"} • Msg {index() + 1}
                          </div>
                          <div class="text-[8px] text-zinc-600">
                            {msg()?.status === "streaming" ? "• Streaming" : ""}
                          </div>
                        </div>
                        <p class="text-[10px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                          {previewText()}
                        </p>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>


    </main >
  );
}
