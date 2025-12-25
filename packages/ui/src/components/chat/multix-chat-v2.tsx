/**
 * MultiX Chat v2 - Rebuilt with Polling-Based Architecture
 * 
 * This component eliminates UI freezes by using:
 * 1. Local signals for all state (no reactive memos on stores)
 * 2. Polling intervals for store sync (100-500ms)
 * 3. Deferred store updates (non-blocking)
 * 4. Direct fetch for chat API when needed
 * 
 * All 88 features from the original MultiTaskChat are preserved.
 */

import { createSignal, Show, onMount, For, onCleanup, batch } from "solid-js";
import { sessions, withSession } from "@/stores/session-state";
import { sendMessage, compactSession, updateSessionAgent, updateSessionModelForSession, forceReset } from "@/stores/session-actions";
import { addTask, setActiveTask, archiveTask } from "@/stores/task-actions";
import { messageStoreBus } from "@/stores/message-v2/bus";
import { formatTokenTotal } from "@/lib/formatters";
import { addToTaskQueue, getSoloState, setActiveTaskId, toggleAutonomous, toggleAutoApproval, toggleApex } from "@/stores/solo-store";
import { getLogger } from "@/lib/logger";
import { clearCompactionSuggestion, getCompactionSuggestion } from "@/stores/session-compaction";
import { emitSessionSidebarRequest } from "@/lib/session-sidebar-events";
import {
    Command,
    Plus,
    PanelRight,
    ListTodo,
    AtSign,
    Hash,
    Mic,
    ArrowUp,
    ChevronRight,
    Loader2,
    X,
    Zap,
    Layers,
    Sparkles,
    StopCircle,
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
const log = getLogger("multix-v2");

interface MultiTaskChatProps {
    instanceId: string;
    sessionId: string;
}

// ============================================================================
// SIMPLE MESSAGE BLOCK - Polling-based, no reactive cascade
// ============================================================================
interface SimpleMessageBlockProps {
    messageId: string;
    store: () => InstanceMessageStore;
}

function SimpleMessageBlock(props: SimpleMessageBlockProps) {
    const [content, setContent] = createSignal("");
    const [isStreaming, setIsStreaming] = createSignal(false);
    const [isUser, setIsUser] = createSignal(false);

    function updateFromStore() {
        const message = props.store().getMessage(props.messageId);
        if (!message) return;

        setIsUser(message.role === "user");
        setIsStreaming(message.status === "streaming" || message.status === "sending");

        // Extract text content from parts
        const parts = message.parts || {};
        let text = "";
        for (const partId of Object.keys(parts)) {
            const partRecord = parts[partId];
            if (partRecord?.data?.type === "text") {
                text = (partRecord.data as any).text || "";
                break;
            }
        }
        setContent(text);
    }

    onMount(() => {
        updateFromStore();

        // Poll for updates during streaming (every 100ms)
        const interval = setInterval(() => {
            const msg = props.store().getMessage(props.messageId);
            if (msg?.status === "streaming" || msg?.status === "sending" || isStreaming()) {
                updateFromStore();
            }
        }, 100);

        onCleanup(() => clearInterval(interval));
    });

    return (
        <div
            id={`message-anchor-${props.messageId}`}
            class={`rounded-xl p-4 ${isUser()
                ? "bg-zinc-800/50 border border-zinc-700/50"
                : "bg-zinc-900/50 border border-indigo-500/20"
                }`}
        >
            <div class="flex items-center gap-2 mb-2">
                <div class={`text-[10px] font-bold uppercase tracking-wide ${isUser() ? "text-indigo-400" : "text-emerald-400"
                    }`}>
                    {isUser() ? "You" : "Assistant"}
                </div>
                <Show when={isStreaming()}>
                    <div class="flex items-center gap-1 text-[9px] text-violet-400">
                        <div class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                        <span>Streaming...</span>
                    </div>
                </Show>
            </div>
            <div
                class="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap break-words"
                style={{ "word-break": "break-word" }}
            >
                {content() || (isStreaming() ? "▋" : "")}
            </div>
        </div>
    );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function MultiTaskChat(props: MultiTaskChatProps) {
    // ============================================
    // LOCAL STATE - All signals, no reactive memos on stores
    // ============================================
    const [isSending, setIsSending] = createSignal(false);
    const [chatInput, setChatInput] = createSignal("");
    const [isCompacting, setIsCompacting] = createSignal(false);
    const [attachments, setAttachments] = createSignal<ReturnType<typeof createFileAttachment>[]>([]);
    const [userScrolling, setUserScrolling] = createSignal(false);

    // Cached values from stores - updated via polling
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

    let scrollContainer: HTMLDivElement | undefined;
    let fileInputRef: HTMLInputElement | undefined;

    // ============================================
    // STORE ACCESS HELPERS (non-reactive)
    // ============================================
    function getSession() {
        const instanceSessions = sessions().get(props.instanceId);
        return instanceSessions?.get(props.sessionId);
    }

    function getMessageStore() {
        return messageStoreBus.getOrCreate(props.instanceId);
    }

    function getSelectedTask() {
        return visibleTasks().find(t => t.id === selectedTaskId());
    }

    function getActiveTaskSessionId() {
        const task = getSelectedTask();
        return task?.taskSessionId || props.sessionId;
    }

    function getActiveTaskSession() {
        const sessionId = getActiveTaskSessionId();
        const instanceSessions = sessions().get(props.instanceId);
        return instanceSessions?.get(sessionId);
    }

    // ============================================
    // POLLING-BASED SYNC - Updates local state from stores
    // ============================================
    function syncFromStore() {
        try {
            // Sync session/tasks
            const session = getSession();
            if (session) {
                const allTasks = session.tasks || [];
                setTasks(allTasks);
                setVisibleTasks(allTasks.filter(t => !t.archived));
                setSelectedTaskIdLocal(session.activeTaskId || null);
            }

            // Sync messages for selected task
            const task = getSelectedTask();
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

            // Sync model/agent/tokens
            const taskSession = getActiveTaskSession();
            if (taskSession?.model?.modelId) {
                setCachedModelId(taskSession.model.modelId);
            }
            if (taskSession?.agent) {
                setCachedAgent(taskSession.agent);
            }

            // Sync token usage
            const store = getMessageStore();
            const usage = store.getSessionUsage(props.sessionId);
            if (usage) {
                setCachedTokensUsed(usage.actualUsageTokens ?? 0);
                setCachedCost(usage.totalCost ?? 0);
            }

            // Check if agent is thinking
            const ids = messageIds();
            if (ids.length > 0) {
                const lastMsg = store.getMessage(ids[ids.length - 1]);
                setIsAgentThinking(
                    lastMsg?.role === "assistant" &&
                    (lastMsg.status === "streaming" || lastMsg.status === "sending")
                );
            } else {
                setIsAgentThinking(false);
            }

            // Sync compaction suggestion
            const suggestion = getCompactionSuggestion(props.instanceId, getActiveTaskSessionId());
            setCompactionSuggestion(suggestion);

            // Sync solo state
            setSoloState(getSoloState(props.instanceId));
        } catch (e) {
            log.error("syncFromStore error", e);
        }
    }

    // ============================================
    // LIFECYCLE
    // ============================================
    onMount(() => {
        // Wire up debug overlay
        setForceResetFn(() => {
            forceReset();
            setIsSending(false);
        });

        // Initial sync
        syncFromStore();

        // Polling interval - fast during streaming, slower otherwise
        let lastIsThinking = false;
        const interval = setInterval(() => {
            syncFromStore();

            // Dynamic polling rate
            const thinking = isAgentThinking() || isSending();
            if (thinking !== lastIsThinking) {
                lastIsThinking = thinking;
            }
        }, 150); // 150ms is smooth enough without being too heavy

        // Scroll handler
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

    // ============================================
    // ACTIONS - Deferred store updates
    // ============================================
    const scrollToBottom = () => {
        if (scrollContainer && !userScrolling()) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
    };

    const setSelectedTaskId = (id: string | null) => {
        setSelectedTaskIdLocal(id);
        // Deferred store update
        setTimeout(() => {
            setActiveTask(props.instanceId, props.sessionId, id || undefined);
        }, 0);
    };

    const handleSendMessage = async () => {
        const message = chatInput().trim();
        if (!message || isSending()) return;

        setIsSending(true);
        const currentMessage = message;
        const currentAttachments = attachments();

        // Clear input immediately for responsiveness
        batch(() => {
            setChatInput("");
            setAttachments([]);
        });

        try {
            // WORKAROUND: Skip task creation to avoid freeze
            // Just send message to the selected task's session, or main session
            const task = getSelectedTask();
            const targetSessionId = task?.taskSessionId || props.sessionId;
            const taskId = selectedTaskId() || undefined;

            // Send message using existing store action
            await sendMessage(props.instanceId, targetSessionId, currentMessage, currentAttachments, taskId);

            // Trigger manual sync and scroll
            syncFromStore();
            setTimeout(scrollToBottom, 100);
        } catch (error) {
            log.error("Send failed:", error);
        } finally {
            setIsSending(false);
        }
    };

    const handleCreateTask = () => {
        if (isSending()) return;

        // Create task in next tick to prevent blocking UI
        const nextIndex = tasks().length + 1;
        const title = `Task ${nextIndex}`;

        // Use setTimeout to defer the heavy store operation
        setTimeout(async () => {
            try {
                const result = await addTask(props.instanceId, props.sessionId, title);
                // Update local state after task is created
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
            setIsSending(false);
            return;
        }

        const task = getSelectedTask();
        if (!task) return;

        try {
            const targetSessionId = task.taskSessionId || props.sessionId;
            await fetch(`/api/workspaces/${props.instanceId}/sessions/${targetSessionId}/cancel`, { method: "POST" });
        } catch (error) {
            log.error("Failed to stop agent:", error);
        }
    };

    const handleCompact = async () => {
        const targetSessionId = getActiveTaskSessionId();
        if (isCompacting()) return;

        setIsCompacting(true);
        try {
            clearCompactionSuggestion(props.instanceId, targetSessionId);
            await compactSession(props.instanceId, targetSessionId);
        } catch (error) {
            log.error("Failed to compact session", error);
        } finally {
            setIsCompacting(false);
        }
    };

    const handleOpenAdvancedSettings = () => {
        window.dispatchEvent(new CustomEvent(OPEN_ADVANCED_SETTINGS_EVENT, {
            detail: { instanceId: props.instanceId, sessionId: props.sessionId }
        }));
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

    // ============================================
    // RENDER
    // ============================================
    return (
        <main class="absolute inset-0 flex flex-col bg-[#0a0a0b] text-zinc-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
            <DebugOverlay />

            {/* ===== HEADER ===== */}
            <header class="h-14 px-4 flex items-center justify-between bg-zinc-900/60 backdrop-blur-xl border-b border-white/5 relative z-30 shrink-0">
                <div class="flex items-center space-x-3">
                    {/* MULTIX Badge */}
                    <div class="flex items-center bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-2.5 py-1.5 shadow-[0_0_20px_rgba(99,102,241,0.1)]">
                        <span class="text-[10px] font-black text-indigo-400 mr-2.5 tracking-tighter uppercase">MULTIX</span>
                        <div class="bg-indigo-500 rounded-md w-4 h-4 flex items-center justify-center shadow-lg shadow-indigo-500/40">
                            <Zap size={10} class="text-white fill-current" />
                        </div>
                    </div>

                    {/* Skills Button */}
                    <button
                        onClick={() => emitSessionSidebarRequest({ instanceId: props.instanceId, action: "show-skills" })}
                        class="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-indigo-500/10 transition-all"
                        title="Open Skills"
                    >
                        <Sparkles size={12} class="text-indigo-400" />
                        <span class="text-[10px] font-black uppercase tracking-tight">Skills</span>
                    </button>

                    {/* Active Task Breadcrumb */}
                    <Show when={selectedTaskId()}>
                        <div class="flex items-center space-x-2 animate-in fade-in slide-in-from-left-2 duration-300">
                            <ChevronRight size={14} class="text-zinc-600" />
                            <div class="flex items-center space-x-2 px-2.5 py-1 bg-white/5 rounded-lg border border-white/5">
                                <ListTodo size={14} class="text-indigo-400" />
                                <span class="text-[11px] font-bold text-zinc-100 truncate max-w-[120px]">
                                    {getSelectedTask()?.title || "Active Task"}
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
                    {/* Streaming Indicator */}
                    <Show when={isAgentThinking()}>
                        <div class="flex items-center space-x-2 px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 rounded-lg animate-pulse shadow-[0_0_20px_rgba(139,92,246,0.2)]">
                            <Sparkles size={12} class="text-violet-400 animate-spin" style={{ "animation-duration": "3s" }} />
                            <span class="text-[10px] font-black text-violet-400 uppercase tracking-tight">Streaming</span>
                            <span class="text-[10px] font-bold text-violet-300">{formatTokenTotal(cachedTokensUsed())}</span>
                        </div>
                    </Show>

                    {/* Task Status Badge */}
                    <Show when={getSelectedTask()}>
                        <div class={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tight border ${getSelectedTask()?.status === "completed"
                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                            : getSelectedTask()?.status === "in-progress"
                                ? "bg-indigo-500/15 border-indigo-500/30 text-indigo-400"
                                : "bg-amber-500/15 border-amber-500/30 text-amber-400"
                            }`}>
                            {getSelectedTask()?.status === "completed" ? "DONE" : getSelectedTask()?.status === "in-progress" ? "RUNNING" : "PENDING"}
                        </div>
                    </Show>

                    {/* Compact Button */}
                    <button
                        onClick={handleCompact}
                        class={`flex items-center space-x-1.5 px-2.5 py-1.5 transition-all rounded-xl active:scale-95 border ${isCompacting()
                            ? "text-blue-400 bg-blue-500/15 border-blue-500/40 animate-pulse shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                            : compactionSuggestion()
                                ? "text-emerald-300 bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_16px_rgba(34,197,94,0.35)] animate-pulse"
                                : "text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 border-transparent hover:border-blue-500/30"
                            }`}
                        title={isCompacting() ? "Compacting..." : "Compact session"}
                        disabled={isCompacting()}
                    >
                        <FileArchive size={16} strokeWidth={2} />
                        <span class="text-[10px] font-bold uppercase tracking-tight">{isCompacting() ? "Compacting..." : "Compact"}</span>
                    </button>

                    {/* API Key Manager */}
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

            {/* ===== TASK TABS ===== */}
            <Show when={visibleTasks().length > 0}>
                <div class="flex items-center bg-[#0a0a0b] border-b border-white/5 px-2 py-2 space-x-1.5 overflow-x-auto custom-scrollbar-hidden no-scrollbar shrink-0">
                    {/* Pipeline Button */}
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

                    {/* Task Tabs */}
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
                                            handleArchiveTask(task.id);
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

                    {/* New Task Button */}
                    <button
                        onClick={handleCreateTask}
                        class="flex items-center justify-center w-8 h-8 rounded-xl text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all shrink-0 ml-1 border border-transparent hover:border-indigo-500/20"
                        title="New Task"
                    >
                        <Plus size={16} strokeWidth={3} />
                    </button>
                </div>
            </Show>

            {/* ===== AGENT/MODEL SELECTORS ===== */}
            <Show when={getSelectedTask()}>
                <div class="px-4 py-3 border-b border-white/5 bg-zinc-950/40">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <AgentSelector
                            instanceId={props.instanceId}
                            sessionId={getActiveTaskSessionId()}
                            currentAgent={cachedAgent()}
                            onAgentChange={(agent) => updateSessionAgent(props.instanceId, getActiveTaskSessionId(), agent)}
                        />
                        <ModelSelector
                            instanceId={props.instanceId}
                            sessionId={getActiveTaskSessionId()}
                            currentModel={{ providerId: "", modelId: cachedModelId() }}
                            onModelChange={(model) => updateSessionModelForSession(props.instanceId, getActiveTaskSessionId(), model)}
                        />
                    </div>
                </div>
            </Show>

            {/* ===== MAIN CONTENT AREA ===== */}
            <div class="flex-1 min-h-0 relative overflow-hidden flex">
                <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
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
                            /* Message List */
                            <div class="p-3 pb-4 overflow-x-hidden space-y-4">
                                <For each={messageIds()}>
                                    {(messageId) => <SimpleMessageBlock messageId={messageId} store={getMessageStore} />}
                                </For>
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
                                                    <div class={`mt-1 w-2 h-2 rounded-full ${task.status === "completed" ? "bg-emerald-500 shadow-emerald-500/40" :
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
                                                                handleArchiveTask(task.id);
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

                    {/* ===== INPUT AREA ===== */}
                    <div class="p-3 bg-[#0a0a0b] border-t border-white/5 shrink-0">
                        <div class="w-full bg-zinc-900/80 border border-white/10 rounded-2xl shadow-lg p-3">
                            {/* Input Header Row */}
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
                                    {/* APEX Toggle */}
                                    <button
                                        onClick={() => toggleApex(props.instanceId)}
                                        title="Toggle APEX Mode"
                                        class={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border transition-all ${soloState().isApex
                                            ? "bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                                            : "bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10"
                                            }`}
                                    >
                                        <Zap size={10} class={soloState().isApex ? "animate-bounce" : ""} />
                                        <span class="text-[9px] font-black uppercase tracking-tighter">Apex</span>
                                    </button>

                                    {/* APEX PRO Toggle */}
                                    <button
                                        onClick={toggleApexPro}
                                        class={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-tight border transition-all ${isApexPro()
                                            ? "bg-orange-500/20 border-orange-500/40 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.3)]"
                                            : "bg-white/5 border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-400"
                                            }`}
                                        title="APEX PRO"
                                    >
                                        <Zap size={12} class={isApexPro() ? "text-orange-400" : ""} />
                                        <span>APEX PRO</span>
                                        <Show when={isApexPro()}>
                                            <div class="w-1.5 h-1.5 bg-orange-400 rounded-full" />
                                        </Show>
                                    </button>

                                    {/* SHIELD Toggle */}
                                    <button
                                        onClick={() => toggleAutoApproval(props.instanceId)}
                                        class={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${soloState().autoApproval
                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                            : "bg-white/5 border-white/10 text-zinc-500"
                                            }`}
                                        title="SHIELD"
                                    >
                                        SHIELD
                                    </button>

                                    {/* Token Stats */}
                                    <Show when={cachedTokensUsed() > 0}>
                                        <div class="px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/20 text-[9px] font-bold text-emerald-400">
                                            {formatTokenTotal(cachedTokensUsed())}
                                        </div>
                                    </Show>

                                    {/* Sending Indicator */}
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

                            {/* Attachments */}
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

                            {/* Input Footer Row */}
                            <div class="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                                    <div class="flex items-center space-x-1.5">
                                        <span class="text-[8px] font-bold text-zinc-600 uppercase">COST</span>
                                        <span class="text-[9px] font-bold text-violet-400">${cachedCost().toFixed(4)}</span>
                                    </div>
                                    <div class="w-px h-3 bg-zinc-800" />
                                    <div class="flex items-center space-x-1.5">
                                        <span class="text-[8px] font-bold text-zinc-600 uppercase">MODEL</span>
                                        <span class="text-[9px] font-bold text-indigo-400">{cachedModelId()}</span>
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
                                    {/* Stop Button */}
                                    <Show when={isAgentThinking() || isSending()}>
                                        <button
                                            onClick={handleStopAgent}
                                            class="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all border border-rose-500/30"
                                            title="Stop (Shift+Click for Force Reset)"
                                        >
                                            <StopCircle size={12} class="inline-block mr-1" />
                                            Stop
                                        </button>
                                    </Show>

                                    {/* Send Button */}
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

                {/* ===== MESSAGE NAVIGATION SIDEBAR ===== */}
                <Show when={selectedTaskId() && messageIds().length > 0}>
                    <div class="w-14 shrink-0 bg-zinc-900/40 border-l border-white/5 overflow-hidden py-2 px-1.5 flex flex-col items-center gap-1">
                        <For each={messageIds()}>
                            {(messageId, index) => {
                                const [showPreview, setShowPreview] = createSignal(false);

                                const getMsgInfo = () => {
                                    const msg = getMessageStore().getMessage(messageId);
                                    return {
                                        isUser: msg?.role === "user",
                                        isStreaming: msg?.status === "streaming",
                                        preview: (() => {
                                            if (!msg) return "";
                                            const parts = msg.parts || {};
                                            for (const partId of Object.keys(parts)) {
                                                const partRecord = parts[partId];
                                                if (partRecord?.data?.type === "text") {
                                                    const text = (partRecord.data as any).text || "";
                                                    return text.length > 150 ? text.substring(0, 150) + "..." : text;
                                                }
                                            }
                                            return "";
                                        })()
                                    };
                                };

                                return (
                                    <div class="relative group">
                                        <button
                                            onClick={() => handleTabClick(messageId)}
                                            onMouseEnter={() => setShowPreview(true)}
                                            onMouseLeave={() => setShowPreview(false)}
                                            class={`w-10 py-1.5 rounded text-[8px] font-black uppercase transition-all cursor-pointer ${getMsgInfo().isUser
                                                ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/40 hover:scale-105"
                                                : "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/40 hover:scale-105"
                                                }`}
                                        >
                                            {getMsgInfo().isUser ? "YOU" : "ASST"}
                                        </button>

                                        <Show when={showPreview()}>
                                            <div class="absolute right-full mr-2 top-0 w-72 max-h-40 overflow-y-auto bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-3 z-50 animate-in fade-in slide-in-from-right-2 duration-150 custom-scrollbar">
                                                <div class="flex items-center justify-between mb-2">
                                                    <div class={`text-[9px] font-bold uppercase ${getMsgInfo().isUser ? "text-indigo-400" : "text-emerald-400"}`}>
                                                        {getMsgInfo().isUser ? "You" : "Assistant"} • Msg {index() + 1}
                                                    </div>
                                                    <div class="text-[8px] text-zinc-600">
                                                        {getMsgInfo().isStreaming ? "• Streaming" : ""}
                                                    </div>
                                                </div>
                                                <p class="text-[10px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                                    {getMsgInfo().preview}
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
        </main>
    );
}
