/**
 * PipelineView - Task Dashboard
 * 
 * Shows all active tasks as cards when no task is selected.
 */

import { For, Show, type Accessor } from "solid-js";
import { Plus, ChevronRight, X } from "lucide-solid";
import type { Task } from "@/types/session";

interface PipelineViewProps {
    visibleTasks: Accessor<Task[]>;
    onTaskClick: (taskId: string) => void;
    onArchiveTask: (taskId: string) => void;
}

export function PipelineView(props: PipelineViewProps) {
    return (
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
                        {props.visibleTasks().length}
                    </span>
                </div>

                <div class="grid gap-3">
                    <Show when={props.visibleTasks().length === 0}>
                        <div class="group relative p-8 rounded-3xl border border-dashed border-white/5 bg-zinc-900/20 flex flex-col items-center justify-center text-center space-y-4 transition-all hover:bg-zinc-900/40 hover:border-white/10">
                            <div class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-zinc-600 group-hover:text-indigo-400 group-hover:scale-110 transition-all duration-500">
                                <Plus size={24} strokeWidth={1.5} />
                            </div>
                            <div class="space-y-1">
                                <p class="text-sm font-bold text-zinc-400">No active tasks</p>
                                <p class="text-[11px] text-zinc-600">Send a message below to start a new thread</p>
                            </div>
                        </div>
                    </Show>

                    <For each={props.visibleTasks()}>
                        {(task) => (
                            <button
                                onClick={() => props.onTaskClick(task.id)}
                                class={`group relative p-4 rounded-2xl border border-white/5 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-indigo-500/30 transition-all duration-300 text-left flex items-start space-x-4 active:scale-[0.98] ${task.title.toLowerCase().includes("smart fix") ? "smart-fix-highlight" : ""}`}
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
                                            props.onArchiveTask(task.id);
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
    );
}
