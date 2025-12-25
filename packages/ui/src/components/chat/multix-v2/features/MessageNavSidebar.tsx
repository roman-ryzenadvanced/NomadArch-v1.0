/**
 * MessageNavSidebar - Quick navigation for messages
 * 
 * Shows YOU/ASST labels with hover preview.
 */

import { For, Show, createSignal, type Accessor } from "solid-js";
import type { InstanceMessageStore } from "@/stores/message-v2/instance-store";

interface MessageNavSidebarProps {
    messageIds: Accessor<string[]>;
    store: () => InstanceMessageStore;
    scrollContainer: HTMLDivElement | undefined;
    onTabClick: (messageId: string) => void;
}

export function MessageNavSidebar(props: MessageNavSidebarProps) {
    return (
        <div class="w-14 shrink-0 bg-zinc-900/40 border-l border-white/5 overflow-hidden py-2 px-1.5 flex flex-col items-center gap-1">
            <For each={props.messageIds()}>
                {(messageId, index) => {
                    const [showPreview, setShowPreview] = createSignal(false);

                    const msg = () => props.store().getMessage(messageId);
                    const isUser = () => msg()?.role === "user";

                    // Get message preview text (first 150 chars)
                    const previewText = () => {
                        const message = msg();
                        if (!message) return "";

                        // Try to get text from parts
                        const parts = message.parts || {};
                        let text = "";
                        for (const partId of Object.keys(parts)) {
                            const partRecord = parts[partId];
                            if (partRecord?.data?.type === "text") {
                                text = (partRecord.data as any).text || "";
                                break;
                            }
                        }

                        // Fallback to direct content
                        if (!text && (message as any).content) {
                            text = (message as any).content;
                        }

                        return text.length > 150 ? text.substring(0, 150) + "..." : text;
                    };

                    return (
                        <div class="relative group">
                            <button
                                onClick={() => props.onTabClick(messageId)}
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
    );
}
