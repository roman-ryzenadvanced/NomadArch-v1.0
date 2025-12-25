import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import { sessions, withSession, setActiveSession } from "@/stores/session-state";
import { instances } from "@/stores/instances";
import { sendMessage } from "@/stores/session-actions";
import { addTask, setActiveTask } from "@/stores/task-actions";
import { messageStoreBus } from "@/stores/message-v2/bus";
import MessageBlockList from "@/components/message-block-list";
import { 
  Command,
  Plus,
  CheckCircle2,
  MoreHorizontal,
  PanelRight,
  ListTodo,
  AtSign,
  Hash,
  Mic,
  ArrowUp,
  Terminal,
  FileCode2,
  ChevronRight,
  Loader2,
  AlertCircle,
  Clock,
  Code2,
} from "lucide-solid";
import type { Task, TaskStatus } from "@/types/session";
import type { InstanceMessageStore } from "@/stores/message-v2/instance-store";

interface MultiTaskChatProps {
  instanceId: string;
  sessionId: string;
}

type PanelView = "tasks" | "active";

export default function MultiTaskChat(props: MultiTaskChatProps) {
  const session = () => {
    const instanceSessions = sessions().get(props.instanceId);
    return instanceSessions?.get(props.sessionId);
  };
  const selectedTaskId = () => session()?.activeTaskId || null;
  const setSelectedTaskId = (id: string | null) => setActiveTask(props.instanceId, props.sessionId, id || undefined);
  const [isCreatingTask, setIsCreatingTask] = createSignal(false);
  const [chatInput, setChatInput] = createSignal("");
  const [isSending, setIsSending] = createSignal(false);
  let scrollContainer: HTMLDivElement | undefined;
  const [bottomSentinel, setBottomSentinel] = createSignal<HTMLDivElement | null>(null);

  // Message store integration for chat display
  const messageStore = () => messageStoreBus.getOrCreate(props.instanceId);
  const messageIds = () => messageStore().getSessionMessageIds(props.sessionId);
  const lastAssistantIndex = () => {
    const ids = messageIds();
    const store = messageStore();
    for (let i = ids.length - 1; i >= 0; i--) {
      const msg = store.getMessage(ids[i]);
      if (msg?.role === "assistant") return i;
    }
    return -1;
  };

  // Handle message sending with comprehensive error handling
  const handleSendMessage = async () => {
    const message = chatInput().trim();
    if (!message || isSending()) return;

    const currentInstance = instances().get(props.instanceId);
    const instanceSessions = sessions().get(props.instanceId);
    const currentSession = instanceSessions?.get(props.sessionId);
    const sessionTasks = currentSession?.tasks || [];
    const selectedTask = sessionTasks.find((task: Task) => task.id === selectedTaskId());

    if (!currentInstance || !currentSession) {
      console.error("[MultiTaskChat] Instance or session not available");
      return;
    }

    setIsSending(true);
    try {
      const messageId = await sendMessage(
        props.instanceId,
        props.sessionId,
        message,
        [], // No attachments for now
        selectedTask?.id
      );
      
      // Clear input after successful send
      setChatInput("");
      console.log("[MultiTaskChat] Message sent successfully:", messageId);
    } catch (error) {
      console.error("[MultiTaskChat] Failed to send message:", error);
      // TODO: Show toast notification to user
    } finally {
      setIsSending(false);
    }
  };

  // Handle keyboard shortcuts (Cmd/Ctrl+Enter to send)
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Handle artifact opening via code streamer
  const handleArtifactOpen = (artifact: any) => {
    console.log("[MultiTaskChat] Opening artifact:", artifact);
    // TODO: Implement code streamer integration
    // For now, we'll log artifact and show a placeholder message
    console.log(`[MultiTaskChat] Would open ${artifact.name} (${artifact.type})`);
    // TODO: Show toast notification to user
  };

  const tasks = () => {
    const instanceSessions = sessions().get(props.instanceId);
    const currentSession = instanceSessions?.get(props.sessionId);
    return currentSession?.tasks || [];
  };

  const handleAddTask = () => {
    const taskTitle = `Task ${tasks().length + 1}`;
    addTask(props.instanceId, props.sessionId, taskTitle);
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const selectedTask = () => {
    const instanceSessions = sessions().get(props.instanceId);
    const currentSession = instanceSessions?.get(props.sessionId);
    const sessionTasks = currentSession?.tasks || [];
    return sessionTasks.find(task => task.id === selectedTaskId());
  };

  return (
    <div class="h-full flex flex-col bg-[#0a0a0b]">
      {/* Header */}
      <div class="h-12 px-4 flex items-center justify-between bg-zinc-900/40 backdrop-blur-md border-b border-white/5 relative z-20">
        <div class="flex items-center space-x-3">
          <Show when={!selectedTaskId()} fallback={
            <div class="flex items-center bg-indigo-500/10 border border-indigo-500/20 rounded-md px-2 py-1 shadow-[0_0_15px_rgba(99,102,241,0.1)] transition-all hover:bg-indigo-500/15">
              <span class="text-[10px] font-black text-indigo-400 mr-2 tracking-tighter uppercase">MULTIX</span>
              <div class="bg-indigo-500 rounded-sm w-3.5 h-3.5 flex items-center justify-center p-[1px]">
                 <div class="flex flex-col space-y-[1px] w-full items-center">
                   <div class="flex space-x-[1px]">
                     <div class="w-0.5 h-0.5 bg-black rounded-full" />
                     <div class="w-0.5 h-0.5 bg-black rounded-full" />
                   </div>
                   <div class="w-full h-[0.5px] bg-black rounded-full" />
                 </div>
              </div>
            </div>
          }>
            <button 
              onClick={() => setSelectedTaskId(null)}
              class="flex items-center space-x-2 text-zinc-400 hover:text-white transition-all duration-200 group active:scale-95"
            >
              <ChevronRight size={16} class="rotate-180 group-hover:-translate-x-0.5 transition-transform" />
              <span class="text-xs font-semibold tracking-tight">Pipeline</span>
            </button>
          </Show>
          
          <Show when={selectedTaskId()}>
            <div class="flex items-center space-x-1.5 px-2 py-1 bg-zinc-800/50 rounded-lg border border-white/5">
              <ListTodo size={14} class="text-indigo-400" />
              <span class="text-[10px] font-bold text-zinc-400">{tasks().length}</span>
            </div>
          </Show>
        </div>
        <div class="flex items-center space-x-4">
          <button class="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors hover:bg-zinc-800/50 rounded-md active:scale-90">
            <Command size={16} />
          </button>
          <button 
            onClick={() => setSelectedTaskId(null)}
            class={`p-1.5 rounded-md transition-all duration-200 group ${
              selectedTaskId() 
                ? "bg-indigo-500/10 border-indigo-500/20 text-white" 
                : "text-zinc-500 hover:text-white hover:bg-zinc-800/50"
            }`}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </div>

      <div class="flex-1 relative overflow-hidden flex flex-col">
        <Show when={!selectedTaskId()}>
          {/* TASK LIST VIEW - CODEX 5.1 Styled */}
          <div class="flex-1 flex flex-col bg-zinc-900/20 animate-in fade-in slide-in-from-left-4 duration-300">
            <div class="p-6 space-y-6">
              <div class="flex items-center justify-between">
                <div class="space-y-1">
                  <h2 class="text-xl font-bold text-zinc-100 tracking-tight">Project Pipeline</h2>
                  <p class="text-xs text-zinc-500">Manage and orchestrate agentic tasks</p>
                </div>
                <button 
                  onClick={handleAddTask}
                  class="px-3 py-1.5 bg-indigo-500 text-white rounded-xl flex items-center justify-center hover:bg-indigo-600 active:scale-[0.97] transition-all shadow-lg shadow-indigo-500/20 font-bold text-xs"
                >
                  <Plus size={14} class="mr-2" strokeWidth={3} />
                  New Task
                </button>
              </div>

              {/* Task List */}
              <div class="space-y-3">
                <For each={tasks()}>
                  {(task) => (
                    <div
                      onClick={() => setSelectedTaskId(task.id)}
                      class={`p-4 rounded-xl border transition-all cursor-pointer ${
                        task.id === selectedTaskId()
                          ? "bg-indigo-500/10 border-indigo-500/20"
                          : "bg-zinc-800/40 border-white/5 hover:border-indigo-500/20 hover:bg-indigo-500/5"
                      }`}
                    >
                      <div class="flex items-start justify-between">
                        <div class="flex items-center space-x-3">
                          <div class={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            task.status === "completed"
                              ? "bg-emerald-500/10"
                              : task.status === "in-progress"
                              ? "bg-amber-500/10"
                              : "bg-zinc-700/50"
                          }`}>
                            {task.status === "completed" ? (
                              <CheckCircle2 size={16} class="text-emerald-500" />
                            ) : task.status === "in-progress" ? (
                              <Loader2 size={16} class="text-amber-500 animate-spin" />
                            ) : (
                              <AlertCircle size={16} class="text-zinc-400" />
                            )}
                          </div>
                          <div>
                            <h3 class="text-white font-semibold text-sm">{task.title}</h3>
                            <p class="text-zinc-400 text-xs">{formatTimestamp(task.timestamp)}</p>
                          </div>
                        </div>
                        <ChevronRight size={16} class="text-zinc-600" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <Show when={selectedTaskId()}>
          {/* TASK CHAT VIEW - When task is selected */}
          <div class="flex-1 flex flex-col relative animate-in fade-in slide-in-from-right-4 duration-300">
            <div class="flex-1 overflow-y-auto custom-scrollbar p-6 pb-32">
              <MessageBlockList
                instanceId={props.instanceId}
                sessionId={props.sessionId}
                store={messageStore}
                messageIds={messageIds}
                lastAssistantIndex={lastAssistantIndex}
                scrollContainer={() => scrollContainer}
                setBottomSentinel={setBottomSentinel}
                showThinking={() => true}
                thinkingDefaultExpanded={() => true}
                showUsageMetrics={() => true}
              />
            </div>

            {/* CODEX 5.1 Chat Input Area */}
            <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/95 to-transparent backdrop-blur-md">
              <div class="bg-zinc-900/80 border border-white/10 rounded-2xl shadow-2xl p-4 space-y-4 transition-all focus-within:border-indigo-500/40 focus-within:ring-4 focus-within:ring-indigo-500/5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2.5">
                    <div class="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <AtSign size={10} class="text-white" />
                    </div>
                    <span class="text-[11px] font-bold text-zinc-400 tracking-tight">TASK ASSISTANT</span>
                  </div>
                  <div class="flex items-center space-x-2">
                    <span class="px-1.5 py-0.5 bg-zinc-800 text-[9px] font-black text-zinc-500 uppercase tracking-tighter rounded border border-white/5">
                      {selectedTask()?.status}
                    </span>
                  </div>
                </div>
                
                <div class="flex items-center space-x-3">
                  <div class="relative">
                    <textarea 
                      value={chatInput()}
                      onInput={(e) => setChatInput(e.currentTarget.value)}
                      placeholder="Message assistant about this task..."
                      class="w-full bg-transparent border-none focus:ring-0 text-sm text-zinc-200 placeholder-zinc-600 resize-none min-h-[44px] max-h-32 custom-scrollbar leading-relaxed disabled:opacity-50"
                      onKeyDown={handleKeyDown}
                      disabled={isSending()}
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between pt-3 border-t border-white/5">
                  <div class="flex items-center space-x-4 text-zinc-500">
                    <button class="hover:text-indigo-400 transition-colors active:scale-90"><Hash size={16} /></button>
                    <button class="hover:text-indigo-400 transition-colors active:scale-90"><Mic size={16} /></button>
                    <div class="w-px h-4 bg-zinc-800" />
                    <span class="text-[10px] font-bold text-zinc-600 tracking-widest">CMD + ENTER</span>
                  </div>
                  <button 
                    onClick={handleSendMessage}
                    disabled={!chatInput().trim() || isSending()}
                    class="px-4 py-1.5 bg-zinc-100 text-zinc-950 rounded-xl flex items-center justify-center hover:bg-white active:scale-[0.97] transition-all shadow-lg shadow-white/5 font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-100"
                  >
                    {isSending() ? (
                      <>
                        <div class="w-3 h-3 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin mr-2" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Execute
                        <ArrowUp size={14} class="ml-2" strokeWidth={3} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}