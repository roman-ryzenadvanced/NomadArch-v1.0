/**
 * MINIMAL CHAT BYPASS
 * 
 * This is a stripped-down chat component that:
 * - Uses minimal store access (just for model/session info)
 * - Makes direct fetch calls
 * - Has NO complex effects/memos
 * - Renders messages as a simple list
 * 
 * Purpose: Test if the UI responsiveness issue is in the
 * reactivity system or something else entirely.
 */

import { createSignal, For, Show, onMount } from "solid-js"
import { sessions } from "@/stores/session-state"

interface Message {
    id: string
    role: "user" | "assistant"
    content: string
    timestamp: number
    status: "sending" | "streaming" | "complete" | "error"
}

interface MinimalChatProps {
    instanceId: string
    sessionId: string
}

export function MinimalChat(props: MinimalChatProps) {
    const [messages, setMessages] = createSignal<Message[]>([])
    const [inputText, setInputText] = createSignal("")
    const [isLoading, setIsLoading] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [currentModel, setCurrentModel] = createSignal("minimax-m1")

    let scrollContainer: HTMLDivElement | undefined
    let inputRef: HTMLTextAreaElement | undefined

    function generateId() {
        return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    }

    function scrollToBottom() {
        if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        }
    }

    // Get model from session on mount (one-time read, no reactive dependency)
    onMount(() => {
        try {
            const instanceSessions = sessions().get(props.instanceId)
            const session = instanceSessions?.get(props.sessionId)
            if (session?.model?.modelId) {
                setCurrentModel(session.model.modelId)
            }
        } catch (e) {
            console.warn("Could not get session model, using default", e)
        }
        inputRef?.focus()
    })

    async function sendMessage() {
        const text = inputText().trim()
        if (!text || isLoading()) return

        setError(null)
        setInputText("")
        setIsLoading(true)

        const userMessage: Message = {
            id: generateId(),
            role: "user",
            content: text,
            timestamp: Date.now(),
            status: "complete"
        }

        const assistantMessage: Message = {
            id: generateId(),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            status: "streaming"
        }

        // Add messages to state
        setMessages(prev => [...prev, userMessage, assistantMessage])
        scrollToBottom()

        try {
            // Direct fetch with streaming
            const response = await fetch("/api/ollama/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: currentModel(),
                    messages: [
                        ...messages().filter(m => m.status === "complete").map(m => ({ role: m.role, content: m.content })),
                        { role: "user", content: text }
                    ],
                    stream: true
                })
            })

            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`)
            }

            const reader = response.body?.getReader()
            if (!reader) throw new Error("No response body")

            const decoder = new TextDecoder()
            let fullContent = ""
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed.startsWith("data:")) continue
                    const data = trimmed.slice(5).trim()
                    if (!data || data === "[DONE]") continue

                    try {
                        const chunk = JSON.parse(data)
                        const delta = chunk?.message?.content
                        if (typeof delta === "string" && delta.length > 0) {
                            fullContent += delta

                            // Update assistant message content (simple state update)
                            setMessages(prev =>
                                prev.map(m =>
                                    m.id === assistantMessage.id
                                        ? { ...m, content: fullContent }
                                        : m
                                )
                            )
                            scrollToBottom()
                        }
                    } catch {
                        // Ignore parse errors
                    }
                }
            }

            // Mark as complete
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantMessage.id
                        ? { ...m, status: "complete" }
                        : m
                )
            )
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : "Unknown error"
            setError(errorMsg)

            // Mark as error
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantMessage.id
                        ? { ...m, status: "error", content: `Error: ${errorMsg}` }
                        : m
                )
            )
        } finally {
            setIsLoading(false)
            scrollToBottom()
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    return (
        <div style={{
            display: "flex",
            "flex-direction": "column",
            height: "100%",
            background: "#0a0a0b",
            color: "#e4e4e7"
        }}>
            {/* Header */}
            <div style={{
                padding: "16px",
                "border-bottom": "1px solid #27272a",
                background: "#18181b"
            }}>
                <h2 style={{ margin: 0, "font-size": "16px" }}>
                    🧪 Minimal Chat (Bypass Mode)
                </h2>
                <p style={{ margin: "4px 0 0", "font-size": "12px", color: "#71717a" }}>
                    Model: {currentModel()} | Testing UI responsiveness
                </p>
            </div>

            {/* Messages */}
            <div
                ref={scrollContainer}
                style={{
                    flex: 1,
                    overflow: "auto",
                    padding: "16px"
                }}
            >
                <Show when={messages().length === 0}>
                    <div style={{
                        "text-align": "center",
                        color: "#71717a",
                        padding: "48px"
                    }}>
                        Send a message to test UI responsiveness
                    </div>
                </Show>

                <For each={messages()}>
                    {(message) => (
                        <div style={{
                            "margin-bottom": "16px",
                            padding: "12px",
                            background: message.role === "user" ? "#27272a" : "#18181b",
                            "border-radius": "8px",
                            "border-left": message.role === "assistant" ? "3px solid #6366f1" : "none"
                        }}>
                            <div style={{
                                "font-size": "11px",
                                color: "#71717a",
                                "margin-bottom": "8px"
                            }}>
                                {message.role === "user" ? "You" : "Assistant"}
                                {message.status === "streaming" && " (streaming...)"}
                                {message.status === "error" && " (error)"}
                            </div>
                            <div style={{
                                "white-space": "pre-wrap",
                                "word-break": "break-word",
                                "font-size": "14px",
                                "line-height": "1.6"
                            }}>
                                {message.content || (message.status === "streaming" ? "▋" : "")}
                            </div>
                        </div>
                    )}
                </For>
            </div>

            {/* Error display */}
            <Show when={error()}>
                <div style={{
                    padding: "8px 16px",
                    background: "#7f1d1d",
                    color: "#fecaca",
                    "font-size": "12px"
                }}>
                    Error: {error()}
                </div>
            </Show>

            {/* Input area */}
            <div style={{
                padding: "16px",
                "border-top": "1px solid #27272a",
                background: "#18181b"
            }}>
                <div style={{ display: "flex", gap: "8px" }}>
                    <textarea
                        ref={inputRef}
                        value={inputText()}
                        onInput={(e) => setInputText(e.currentTarget.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message... (Enter to send)"
                        disabled={isLoading()}
                        style={{
                            flex: 1,
                            padding: "12px",
                            background: "#27272a",
                            border: "1px solid #3f3f46",
                            "border-radius": "8px",
                            color: "#e4e4e7",
                            resize: "none",
                            "font-size": "14px",
                            "min-height": "48px",
                            "max-height": "150px"
                        }}
                        rows={1}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={isLoading() || !inputText().trim()}
                        style={{
                            padding: "12px 24px",
                            background: isLoading() ? "#3f3f46" : "#6366f1",
                            color: "white",
                            border: "none",
                            "border-radius": "8px",
                            cursor: isLoading() ? "wait" : "pointer",
                            "font-weight": "600"
                        }}
                    >
                        {isLoading() ? "..." : "Send"}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default MinimalChat
