/**
 * SimpleMessageBlock - Polling-based message renderer
 * 
 * Updates content via interval, not reactive cascade.
 * This prevents the freeze during streaming.
 */

import { createSignal, Show, onMount, onCleanup } from "solid-js";
import type { InstanceMessageStore } from "@/stores/message-v2/instance-store";

interface SimpleMessageBlockProps {
    messageId: string;
    store: () => InstanceMessageStore;
}

export function SimpleMessageBlock(props: SimpleMessageBlockProps) {
    const [content, setContent] = createSignal("");
    const [isStreaming, setIsStreaming] = createSignal(false);
    const [isUser, setIsUser] = createSignal(false);
    const [timestamp, setTimestamp] = createSignal("");
    const [tokenCount, setTokenCount] = createSignal(0);

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

        // Fallback to direct content
        if (!text && (message as any).content) {
            text = (message as any).content;
        }

        setContent(text);
        setTokenCount(Math.ceil(text.length / 4));

        // Note: MessageRecord doesn't have time property, skip timestamp
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
            class={`rounded-xl p-4 transition-all min-w-0 overflow-hidden ${isUser()
                ? "bg-zinc-800/50 border border-zinc-700/50"
                : "bg-zinc-900/50 border border-indigo-500/20"
                }`}
        >
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <div class={`text-[10px] font-bold uppercase tracking-wide ${isUser() ? "text-indigo-400" : "text-emerald-400"}`}>
                        {isUser() ? "You" : "Assistant"}
                    </div>
                    <Show when={isStreaming()}>
                        <div class="flex items-center gap-2">
                            <div class="flex items-center gap-1 text-[9px] text-violet-400">
                                <div class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                                <span>Thinking...</span>
                            </div>
                            <span class="text-[9px] font-mono text-zinc-500 bg-zinc-800/50 px-1 rounded">
                                {tokenCount()} tks
                            </span>
                        </div>
                    </Show>
                </div>
                <div class="text-[9px] text-zinc-600">{timestamp()}</div>
            </div>
            <div
                class="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap break-words overflow-hidden"
                style={{ "word-break": "break-word", "overflow-wrap": "anywhere" }}
            >
                {content() || (isStreaming() ? "▋" : "")}
            </div>
        </div>
    );
}
