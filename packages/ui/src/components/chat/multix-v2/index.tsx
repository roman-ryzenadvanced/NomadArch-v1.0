/**
 * MultiX v2 - Main Entry Point
 * 
 * A complete rebuild of the MultiTaskChat component with:
 * 1. Local signals + polling (no reactive cascade = no freeze)
 * 2. 100% feature parity with original
 * 3. New features: Context-Engine, Compaction, Prompt Enhancement
 */

import { createSignal, Show, onMount, For, onCleanup, batch } from "solid-js";
import toast from "solid-toast";
import { sessions, activeSessionId, setActiveSession } from "@/stores/session-state";
import { sendMessage, compactSession, updateSessionAgent, updateSessionModelForSession, forceReset, abortSession } from "@/stores/session-actions";
import { addTask, setActiveTask, archiveTask } from "@/stores/task-actions";
import { messageStoreBus } from "@/stores/message-v2/bus";
import { formatTokenTotal } from "@/lib/formatters";
import { addToTaskQueue, getSoloState, setActiveTaskId, toggleAutonomous, toggleAutoApproval, toggleApex } from "@/stores/solo-store";
import { getLogger } from "@/lib/logger";
import { clearCompactionSuggestion, getCompactionSuggestion } from "@/stores/session-compaction";
import { emitSessionSidebarRequest } from "@/lib/session-sidebar-events";
import {
    Command, Plus, PanelRight, ListTodo, AtSign, Hash, Mic, ArrowUp,
    ChevronRight, Loader2, X, Zap, Layers, Sparkles, StopCircle, Key,
    FileArchive, Paperclip, Wand2, Shield,
} from "lucide-solid";
// Using Lite versions to avoid reactive cascade
// import ModelSelector from "@/components/model-selector";
// import AgentSelector from "@/components/agent-selector";
import { DebugOverlay, setForceResetFn } from "@/components/debug-overlay";
import AttachmentChip from "@/components/attachment-chip";
import { createFileAttachment } from "@/types/attachment";
import type { InstanceMessageStore } from "@/stores/message-v2/instance-store";
import type { Task, Session } from "@/types/session";

// Sub-components
import { SimpleMessageBlock } from "./core/SimpleMessageBlock";
import { PipelineView } from "./features/PipelineView";
import { MessageNavSidebar } from "./features/MessageNavSidebar";
import { enhancePrompt } from "./features/PromptEnhancer";
import { LiteAgentSelector } from "./features/LiteAgentSelector";
import { LiteModelSelector } from "./features/LiteModelSelector";
import { LiteSkillsSelector } from "./features/LiteSkillsSelector";
import MessageBlockList from "@/components/message-block-list";

const OPEN_ADVANCED_SETTINGS_EVENT = "open-advanced-settings";
const log = getLogger("multix-v2");

interface MultiXV2Props {
    instanceId: string;
    sessionId: string;
}

export default function MultiXV2(props: MultiXV2Props) {
    // ============================================================================
    // LOCAL STATE (No reactive memos on stores - polling instead)
    // ============================================================================
    // Per-task sending state (Map of taskId -> boolean)
    const [sendingTasks, setSendingTasks] = createSignal<Set<string>>(new Set());
    const [chatInput, setChatInput] = createSignal("");
    const [isCompacting, setIsCompacting] = createSignal(false);
    const [attachments, setAttachments] = createSignal<ReturnType<typeof createFileAttachment>[]>([]);
    const [userScrolling, setUserScrolling] = createSignal(false);
    const [isEnhancing, setIsEnhancing] = createSignal(false);

    // Cached store values - updated via polling
    const [tasks, setTasks] = createSignal<Task[]>([]);
    const [visibleTasks, setVisibleTasks] = createSignal<Task[]>([]);
    const [selectedTaskId, setSelectedTaskIdLocal] = createSignal<string | null>(null);
    const [messageIds, setMessageIds] = createSignal<string[]>([]);
    const [cachedModelId, setCachedModelId] = createSignal("unknown");
    const [cachedAgent, setCachedAgent] = createSignal("");
    const [cachedTokensUsed, setCachedTokensUsed] = createSignal(0);
    const [cachedCost, setCachedCost] = createSignal(0);
    const [isAgentThinking, setIsAgentThinking] = createSignal(false);
    const [compactionSuggestion, setCompactionSuggestion] = createSignal<{ reason: string } | null>(null);
    const [soloState, setSoloState] = createSignal({ isApex: false, isAutonomous: false, autoApproval: false, activeTaskId: null as string | null });
    const [lastAssistantIndex, setLastAssistantIndex] = createSignal(-1);
    const [bottomSentinel, setBottomSentinel] = createSignal<HTMLDivElement | null>(null);

    // Helper to check if CURRENT task is sending
    const isSending = () => {
        const taskId = selectedTaskId();
        if (!taskId) return sendingTasks().size > 0; // If no task selected, check if any is sending
        return sendingTasks().has(taskId);
    };

    // Helper to set sending state for a task
    const setTaskSending = (taskId: string, sending: boolean) => {
        setSendingTasks(prev => {
            const next = new Set(prev);
            if (sending) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    let scrollContainer: HTMLDivElement | undefined;
    let fileInputRef: HTMLInputElement | undefined;

    // ============================================================================
    // STORE ACCESS HELPERS (Non-reactive reads)
    // ============================================================================
    function getSession(): Session | undefined {
        const instanceSessions = sessions().get(props.instanceId);
        return instanceSessions?.get(props.sessionId);
    }

    function getMessageStore(): InstanceMessageStore {
        return messageStoreBus.getOrCreate(props.instanceId);
    }

    function getSelectedTask(): Task | undefined {
        return visibleTasks().find(t => t.id === selectedTaskId());
    }

    function getActiveTaskSessionId(): string {
        const task = getSelectedTask();
        return task?.taskSessionId || props.sessionId;
    }

    function getActiveTaskSession(): Session | undefined {
        const sessionId = getActiveTaskSessionId();
        const instanceSessions = sessions().get(props.instanceId);
        return instanceSessions?.get(sessionId);
    }

    // ============================================================================
    // POLLING-BASED SYNC (Updates local state from stores every 150ms)
    // ============================================================================
    function syncFromStore() {
        try {
            const session = getSession();
            if (session) {
                const allTasks = session.tasks || [];
                setTasks(allTasks);
                setVisibleTasks(allTasks.filter(t => !t.archived));
                // NOTE: Don't overwrite selectedTaskId from store - local state is authoritative
                // This prevents the reactive cascade when the store updates
            }

            // Get message IDs for currently selected task
            const currentTaskId = selectedTaskId();
            if (currentTaskId) {
                const task = visibleTasks().find(t => t.id === currentTaskId);
                if (task) {
                    const store = getMessageStore();
                    if (task.taskSessionId) {
                        setMessageIds(store.getSessionMessageIds(task.taskSessionId));
                    } else {
                        setMessageIds(task.messageIds || []);
                    }
                } else {
                    setMessageIds([]);
                }
            } else {
                setMessageIds([]);
            }

            const taskSession = getActiveTaskSession();
            if (taskSession?.model?.modelId) {
                setCachedModelId(taskSession.model.modelId);
            }
            if (taskSession?.agent) {
                setCachedAgent(taskSession.agent);
            }

            const store = getMessageStore();
            const usage = store.getSessionUsage(props.sessionId);
            if (usage) {
                setCachedTokensUsed(usage.actualUsageTokens ?? 0);
                setCachedCost(usage.totalCost ?? 0);
            }

            const ids = messageIds();
            if (ids.length > 0) {
                const lastMsg = store.getMessage(ids[ids.length - 1]);
                setIsAgentThinking(
                    lastMsg?.role === "assistant" &&
                    (lastMsg.status === "streaming" || lastMsg.status === "sending")
                );

                // Calculate lastAssistantIndex
                let lastIdx = -1;
                for (let i = ids.length - 1; i >= 0; i--) {
                    const msg = store.getMessage(ids[i]);
                    if (msg?.role === "assistant") {
                        lastIdx = i;
                        break;
                    }
                }
                setLastAssistantIndex(lastIdx);
            } else {
                setIsAgentThinking(false);
                setLastAssistantIndex(-1);
            }

            const suggestion = getCompactionSuggestion(props.instanceId, getActiveTaskSessionId());
            setCompactionSuggestion(suggestion);

            setSoloState(getSoloState(props.instanceId));
        } catch (e) {
            log.error("syncFromStore error", e);
        }
    }

    // ============================================================================
    // LIFECYCLE
    // ============================================================================
    onMount(() => {
        setForceResetFn(() => {
            forceReset();
            // Clear all sending states on force reset
            setSendingTasks(new Set<string>());
        });

        syncFromStore();

        const interval = setInterval(syncFromStore, 150);

        const handleScroll = () => {
            if (!scrollContainer) return;
            const isAtBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 50;
            setUserScrolling(!isAtBottom);
        };
        scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });

        onCleanup(() => {
            clearInterval(interval);
            scrollContainer?.removeEventListener('scroll', handleScroll);
        });
    });

    // ============================================================================
    // ACTIONS
    // ============================================================================
    const scrollToBottom = () => {
        if (scrollContainer && !userScrolling()) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
    };

    const setSelectedTaskId = (id: string | null) => {
        // Update local state immediately (fast)
        setSelectedTaskIdLocal(id);

        // Immediately sync to load the new task's agent/model
        syncFromStore();

        // Defer the global store update using idle callback (non-blocking)
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => {
                setActiveTask(props.instanceId, props.sessionId, id || undefined);
            }, { timeout: 500 });
        } else {
            // Fallback: use setTimeout with longer delay
            setTimeout(() => {
                setActiveTask(props.instanceId, props.sessionId, id || undefined);
            }, 50);
        }
    };

    const handleSendMessage = async () => {
        const message = chatInput().trim();
        if (!message) return;

        // Check if THIS specific task is already sending
        const currentTaskId = selectedTaskId();
        if (currentTaskId && sendingTasks().has(currentTaskId)) return;

        const currentMessage = message;
        const currentAttachments = attachments();

        batch(() => {
            setChatInput("");
            setAttachments([]);
        });

        // Track which task we're sending for (might be created below)
        let taskIdForSending: string | null = null;

        try {
            let taskId = currentTaskId;
            let targetSessionId = props.sessionId;

            if (!taskId) {
                // Create new task
                const title = currentMessage.length > 30 ? currentMessage.substring(0, 27) + "..." : currentMessage;
                log.info("[MultiX] Creating task...", { title });
                const result = await addTask(props.instanceId, props.sessionId, title);
                taskId = result.id;
                targetSessionId = result.taskSessionId || props.sessionId;
                log.info("[MultiX] Task created", { taskId, targetSessionId, hasTaskSession: !!result.taskSessionId });

                // Immediately sync to get the new task in our local state
                syncFromStore();

                // Set the selected task
                setSelectedTaskIdLocal(taskId);

                const s = soloState();
                if (s.isAutonomous) {
                    if (!s.activeTaskId) {
                        setActiveTaskId(props.instanceId, taskId);
                    } else {
                        addToTaskQueue(props.instanceId, taskId);
                    }
                }
            } else {
                // Existing task - get up-to-date task info
                syncFromStore();
                const task = visibleTasks().find(t => t.id === taskId);
                targetSessionId = task?.taskSessionId || props.sessionId;
                log.info("[MultiX] Existing task", { taskId, targetSessionId });
            }

            // Mark THIS task as sending
            taskIdForSending = taskId;
            setTaskSending(taskId, true);

            log.info("[MultiX] Sending message", { instanceId: props.instanceId, targetSessionId, messageLength: currentMessage.length, taskId });

            // Send the message (this is async and will stream)
            await sendMessage(props.instanceId, targetSessionId, currentMessage, currentAttachments, taskId || undefined);
            log.info("[MultiX] Message sent successfully");

            // Force sync after message is sent to pick up the new messages
            setTimeout(() => syncFromStore(), 100);
            setTimeout(() => syncFromStore(), 500);
            setTimeout(() => syncFromStore(), 1000);

            setTimeout(scrollToBottom, 150);
        } catch (error) {
            log.error("Send failed:", error);
            console.error("[MultiX] Send failed:", error);
        } finally {
            // Clear sending state for this specific task
            if (taskIdForSending) {
                setTaskSending(taskIdForSending, false);
            }
        }
    };

    const handleCreateTask = () => {
        // Allow creating new tasks even when other tasks are processing
        const nextIndex = tasks().length + 1;
        const title = `Task ${nextIndex} `;

        setTimeout(async () => {
            try {
                const result = await addTask(props.instanceId, props.sessionId, title);
                setSelectedTaskIdLocal(result.id);
                setTimeout(() => syncFromStore(), 50);
            } catch (error) {
                log.error("handleCreateTask failed", error);
            }
        }, 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleStopAgent = async (e?: MouseEvent) => {
        if (e?.shiftKey) {
            forceReset();
            // Clear all sending states on force reset
            setSendingTasks(new Set<string>());
            return;
        }

        const task = getSelectedTask();
        // If no task selected, we might be in global pipeline, use sessionId
        const targetSessionId = task?.taskSessionId || props.sessionId;
        const taskId = task?.id || selectedTaskId();

        try {
            await abortSession(props.instanceId, targetSessionId);

            // Manually force UI update
            if (taskId) {
                setTaskSending(taskId, false);
            }
            setIsAgentThinking(false);

            setTimeout(() => syncFromStore(), 50);
        } catch (error) {
            log.error("Failed to stop agent", error);
        }
    };

    const handleCompact = async () => {
        const targetSessionId = getActiveTaskSessionId();
        if (isCompacting()) return;

        // Get message count to verify we have messages to compact
        const store = getMessageStore();
        const msgIds = store.getSessionMessageIds(targetSessionId);

        log.info("[MultiX] Starting compaction", {
            instanceId: props.instanceId,
            sessionId: targetSessionId,
            messageCount: msgIds.length
        });

        if (msgIds.length < 3) {
            log.info("[MultiX] Session too small to compact", { count: msgIds.length });
            toast.success("Session is already concise. No compaction needed.", {
                icon: <Zap size={14} class="text-amber-400" />
            });
            return;
        }

        setIsCompacting(true);
        const toastId = toast.loading("Compacting session history...");
        try {
            clearCompactionSuggestion(props.instanceId, targetSessionId);
            const result = await compactSession(props.instanceId, targetSessionId);

            // CRITICAL: Restore the parent session as active to prevent navigation away from MultiX
            const currentActive = activeSessionId().get(props.instanceId);
            if (currentActive !== props.sessionId) {
                setActiveSession(props.instanceId, props.sessionId);
            }
            log.info("[MultiX] Compaction complete", {
                success: result.success,
                tokenBefore: result.token_before,
                tokenAfter: result.token_after,
                reduction: result.token_reduction_pct
            });

            toast.success(`Compacted! Reduced by ${result.token_reduction_pct}% (${result.token_after} tokens)`, {
                id: toastId,
                duration: 4000
            });

            // Sync to update UI after compaction
            syncFromStore();
        } catch (error) {
            log.error("Failed to compact session", error);
            toast.error("Compaction failed. Please try again.", { id: toastId });
        } finally {
            setIsCompacting(false);
        }
    };

    const handleOpenAdvancedSettings = () => {
        window.dispatchEvent(new CustomEvent(OPEN_ADVANCED_SETTINGS_EVENT, {
            detail: { instanceId: props.instanceId, sessionId: props.sessionId }
        }));
    };

    const handleEnhancePrompt = async () => {
        const input = chatInput().trim();
        if (!input || isEnhancing()) return;

        setIsEnhancing(true);
        try {
            // Pass sessionId so it uses the task's configured model
            const taskSessionId = getActiveTaskSessionId();
            const enhanced = await enhancePrompt(input, props.instanceId, taskSessionId);
            setChatInput(enhanced);
        } catch (error) {
            log.error("Prompt enhancement failed", error);
        } finally {
            setIsEnhancing(false);
        }
    };

    const toggleApexPro = () => {
        const s = soloState();
        const currentState = s.isAutonomous && s.autoApproval;
        if (currentState) {
            if (s.isAutonomous) toggleAutonomous(props.instanceId);
            if (s.autoApproval) toggleAutoApproval(props.instanceId);
        } else {
            if (!s.isAutonomous) toggleAutonomous(props.instanceId);
            if (!s.autoApproval) toggleAutoApproval(props.instanceId);
        }
    };

    const isApexPro = () => {
        const s = soloState();
        return s.isAutonomous && s.autoApproval;
    };

    const handleArchiveTask = (taskId: string) => {
        archiveTask(props.instanceId, props.sessionId, taskId);
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

    const handleTabClick = (messageId: string) => {
        const anchorId = `message-anchor-${messageId}`;
        const element = scrollContainer?.querySelector(`#${anchorId}`);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            element.classList.add("message-highlight");
            setTimeout(() => element.classList.remove("message-highlight"), 2000);
        }
    };

    // ============================================================================
    // RENDER (Gemini 3 Pro)
    // ============================================================================
    return (
        <div class="absolute inset-0 flex flex-col bg-[#0a0a0b] text-zinc-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
            <DebugOverlay />

            {/* ===== GEMINI 3 PRO HEADER ===== */}
            <header class="h-12 px-2 flex items-center justify-between bg-[#0a0a0b]/90 backdrop-blur-xl border-b border-white/5 relative z-30 shrink-0 select-none">
                <div class="flex items-center gap-2 overflow-hidden flex-1">
                    {/* Brand / Mode Indicator */}
                    <div class="flex items-center gap-2 px-2 py-1 rounded-md text-zinc-400">
                        <Layers size={14} class="text-indigo-500" />
                        <span class="text-[11px] font-bold tracking-wider text-zinc-300">MULTIX</span>
                    </div>

                    <div class="h-4 w-px bg-white/5 shrink-0" />

                    {/* Pipeline / Task Switcher */}
                    <div class="flex items-center gap-1 overflow-x-auto no-scrollbar mask-linear-fade">
                        {/* Pipeline Tab */}
                        <button
                            onClick={() => setSelectedTaskId(null)}
                            class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${!selectedTaskId()
                                ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.1)]"
                                : "text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-white/5"
                                }`}
                        >
                            <span class="font-mono">PIPELINE</span>
                        </button>

                        {/* Active Tasks */}
                        <For each={visibleTasks()}>
                            {(task) => (
                                <button
                                    onClick={() => setSelectedTaskId(task.id)}
                                    class={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border max-w-[140px] ${selectedTaskId() === task.id
                                        ? "bg-zinc-800 text-zinc-100 border-zinc-700 shadow-lg"
                                        : "text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-white/5"
                                        } ${task.title.toLowerCase().includes("smart fix") ? "smart-fix-highlight" : ""}`}
                                >
                                    <div class={`w-1.5 h-1.5 rounded-full ${task.status === "completed" ? "bg-emerald-500" :
                                        task.status === "interrupted" ? "bg-rose-500" :
                                            "bg-indigo-500 animate-pulse"
                                        }`} />
                                    <span class="truncate">{task.title}</span>
                                    <span
                                        onClick={(e) => { e.stopPropagation(); handleArchiveTask(task.id); }}
                                        class="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                                    >
                                        <X size={10} />
                                    </span>
                                </button>
                            )}
                        </For>

                        {/* New Task */}
                        <button
                            onClick={handleCreateTask}
                            class="w-6 h-6 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </div>

                {/* Right Actions */}
                <div class="flex items-center gap-2 shrink-0 pl-4">
                    {/* Stream Status */}
                    <Show when={isAgentThinking()}>
                        <div class="flex items-center gap-2 px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
                            <Loader2 size={10} class="animate-spin text-violet-400" />
                            <span class="text-[9px] font-mono text-violet-300">{formatTokenTotal(cachedTokensUsed())}</span>
                        </div>
                    </Show>

                    <div class="h-4 w-px bg-white/5" />

                    {/* Tools */}
                    <button
                        onClick={handleCompact}
                        disabled={!selectedTaskId()}
                        class="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 rounded-md transition-colors disabled:opacity-30"
                        title="Compact Context"
                    >
                        <FileArchive size={14} />
                    </button>

                    <button
                        onClick={() => emitSessionSidebarRequest({ instanceId: props.instanceId, action: "show-skills" })}
                        class="p-1.5 text-zinc-500 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-md transition-colors"
                        title="Skills"
                    >
                        <Sparkles size={14} />
                    </button>
                </div>
            </header>

            {/* ===== AGENT/MODEL SELECTORS (LITE VERSIONS - PER TASK) ===== */}
            <Show when={getSelectedTask()}>
                <div class="px-4 py-3 border-b border-white/5 bg-[#0a0a0b]">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <LiteAgentSelector
                            instanceId={props.instanceId}
                            sessionId={getActiveTaskSessionId()}
                            currentAgent={cachedAgent()}
                            onAgentChange={(agent) => {
                                // Update the TASK's session, not a global cache
                                const taskSessionId = getActiveTaskSessionId();
                                log.info("[MultiX] Changing agent for task session", { taskSessionId, agent });
                                updateSessionAgent(props.instanceId, taskSessionId, agent);
                                // Force immediate sync to reflect the change
                                setTimeout(() => syncFromStore(), 50);
                            }}
                        />
                        <LiteModelSelector
                            instanceId={props.instanceId}
                            sessionId={getActiveTaskSessionId()}
                            currentModel={{ providerId: "", modelId: cachedModelId() }}
                            onModelChange={(model) => {
                                // Update the TASK's session, not a global cache
                                const taskSessionId = getActiveTaskSessionId();
                                log.info("[MultiX] Changing model for task session", { taskSessionId, model });
                                updateSessionModelForSession(props.instanceId, taskSessionId, model);
                                // Force immediate sync to reflect the change
                                setTimeout(() => syncFromStore(), 50);
                            }}
                        />
                        <LiteSkillsSelector
                            instanceId={props.instanceId}
                            sessionId={getActiveTaskSessionId()}
                        />
                    </div>
                </div>
            </Show>

            {/* ===== MAIN CONTENT AREA (Row Layout) ===== */}
            <div class="flex-1 flex flex-row min-h-0 relative bg-[#050505] overflow-hidden w-full h-full">

                {/* Chat Column */}
                <div class="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    <div ref={scrollContainer} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
                        {/* Compaction Suggestion Banner */}
                        <Show when={compactionSuggestion()}>
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
                            /* Message List - Using full MessageBlockList for proper streaming */
                            <div class="min-h-full pb-4">
                                <MessageBlockList
                                    instanceId={props.instanceId}
                                    sessionId={getActiveTaskSessionId()}
                                    store={getMessageStore}
                                    messageIds={() => messageIds()}
                                    lastAssistantIndex={() => lastAssistantIndex()}
                                    showThinking={() => true}
                                    thinkingDefaultExpanded={() => true}
                                    showUsageMetrics={() => true}
                                    scrollContainer={() => scrollContainer}
                                    setBottomSentinel={setBottomSentinel}
                                />
                                {/* Bottom anchor */}
                                <div id="bottom-anchor" class="h-10 w-full" />
                            </div>
                        }>
                            {/* Pipeline View */}
                            <PipelineView
                                visibleTasks={visibleTasks}
                                onTaskClick={setSelectedTaskId}
                                onArchiveTask={handleArchiveTask}
                            />
                        </Show>
                    </div>

                    {/* ===== INPUT AREA ===== */}
                    <div class="p-4 bg-[#0a0a0b] border-t border-white/5 shrink-0 z-20">
                        {/* Input Container */}
                        <div class="w-full bg-zinc-900/50 border border-white/10 rounded-2xl shadow-sm overflow-hidden focus-within:border-indigo-500/30 transition-all">
                            {/* Input Header Row */}
                            <div class="flex items-center justify-between px-3 pt-2 pb-1">
                                <div class="flex items-center space-x-2">
                                    <div class="flex flex-col">
                                        <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
                                            {selectedTaskId() ? "Task Context" : "Global Pipeline"}
                                        </span>
                                    </div>
                                </div>
                                <div class="flex items-center space-x-1">
                                    {/* APEX / Shield Toggles */}
                                    <button
                                        onClick={() => toggleApex(props.instanceId)}
                                        title="Apex"
                                        class={`p-1 rounded transition-colors ${soloState().isApex ? "text-rose-400 bg-rose-500/10" : "text-zinc-600 hover:text-zinc-400"}`}
                                    >
                                        <Zap size={10} />
                                    </button>
                                    <button
                                        onClick={() => toggleAutoApproval(props.instanceId)}
                                        title="Shield"
                                        class={`p-1 rounded transition-colors ${soloState().autoApproval ? "text-emerald-400 bg-emerald-500/10" : "text-zinc-600 hover:text-zinc-400"}`}
                                    >
                                        <Shield size={10} />
                                    </button>
                                </div>
                            </div>

                            {/* Attachments */}
                            <Show when={attachments().length > 0}>
                                <div class="flex flex-wrap gap-1.5 px-3 py-1">
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
                                onInput={(e) => {
                                    setChatInput(e.currentTarget.value);
                                    e.currentTarget.style.height = "auto";
                                    e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder={selectedTaskId() ? "Message agent..." : "Start a new task..."}
                                class="w-full bg-transparent text-zinc-200 placeholder-zinc-500 text-sm p-3 outline-none resize-none max-h-[300px] min-h-[44px]"
                                rows={1}
                                disabled={isSending()}
                            />

                            {/* Toolbar */}
                            <div class="flex items-center justify-between px-2 pb-2 mt-1 border-t border-white/5 pt-2 bg-zinc-900/30">
                                <div class="flex items-center space-x-1">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        class="hidden"
                                        onChange={handleFileSelect}
                                    />
                                    <button
                                        onClick={() => fileInputRef?.click()}
                                        class="p-1.5 text-zinc-500 hover:text-zinc-300 rounded hover:bg-white/5 transition-colors"
                                    >
                                        <Paperclip size={14} />
                                    </button>
                                    <button
                                        onClick={handleEnhancePrompt}
                                        disabled={!chatInput().trim() || isEnhancing()}
                                        class={`p-1.5 rounded hover:bg-white/5 transition-colors ${isEnhancing() ? "text-amber-400 animate-pulse" : "text-zinc-500 hover:text-amber-300"}`}
                                    >
                                        <Wand2 size={14} class={isEnhancing() ? "animate-spin" : ""} />
                                    </button>
                                </div>

                                <div class="flex items-center space-x-2">
                                    <div class="text-[9px] text-zinc-600 font-mono hidden md:block">
                                        {cachedModelId()}
                                    </div>

                                    {/* Stop Button (visible when agent is thinking) */}
                                    <Show when={isAgentThinking() || isSending()}>
                                        <button
                                            onClick={handleStopAgent}
                                            class="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-all shadow-sm"
                                            title="Stop Agent (Shift+Click = Force Reset)"
                                        >
                                            <StopCircle size={14} strokeWidth={2.5} />
                                        </button>
                                    </Show>

                                    {/* Send Button */}
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={(!chatInput().trim() && attachments().length === 0) || isSending()}
                                        class="p-1.5 bg-zinc-100 hover:bg-white text-black rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                                    >
                                        <Show when={isSending()} fallback={<ArrowUp size={14} strokeWidth={3} />}>
                                            <Loader2 size={14} class="animate-spin" />
                                        </Show>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar (Right) */}
                <Show when={selectedTaskId() && messageIds().length > 0}>
                    <MessageNavSidebar
                        messageIds={messageIds}
                        store={getMessageStore}
                        scrollContainer={scrollContainer}
                        onTabClick={handleTabClick}
                    />
                </Show>
            </div>
        </div>
    );
}
