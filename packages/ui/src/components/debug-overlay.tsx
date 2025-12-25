import { createSignal, onMount, onCleanup, Show } from "solid-js"

// Simple debug log storage (no reactive overhead)
export function addDebugLog(message: string, level: "info" | "warn" | "error" = "info") {
    // Disabled - no-op for performance
}

// HARD STOP function - forces page reload
function hardStop() {
    console.warn("HARD STOP triggered - reloading page")
    window.location.reload()
}

// Force reset function import placeholder
let forceResetFn: (() => void) | null = null

export function setForceResetFn(fn: () => void) {
    forceResetFn = fn
}

export function DebugOverlay() {
    const [visible, setVisible] = createSignal(false)

    // Toggle with Ctrl+Shift+D
    onMount(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === "D") {
                setVisible((v) => !v)
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown))
    })

    return (
        <Show when={visible()}>
            <div
                style={{
                    position: "fixed",
                    top: "10px",
                    right: "10px",
                    "z-index": "99999",
                    background: "rgba(0,0,0,0.9)",
                    color: "#fff",
                    padding: "12px",
                    "border-radius": "8px",
                    "font-family": "monospace",
                    "font-size": "11px",
                    "min-width": "200px",
                    border: "1px solid #333",
                    "pointer-events": "auto",
                }}
            >
                <div style={{ "margin-bottom": "8px", "font-weight": "bold" }}>
                    DEBUG PANEL (Ctrl+Shift+D to toggle)
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                    <button
                        onClick={() => {
                            if (forceResetFn) forceResetFn()
                        }}
                        style={{
                            background: "#f59e0b",
                            color: "#000",
                            border: "none",
                            padding: "6px 12px",
                            "border-radius": "4px",
                            cursor: "pointer",
                            "font-weight": "bold",
                            "font-size": "10px",
                        }}
                    >
                        RESET UI
                    </button>

                    <button
                        onClick={hardStop}
                        style={{
                            background: "#ef4444",
                            color: "#fff",
                            border: "none",
                            padding: "6px 12px",
                            "border-radius": "4px",
                            cursor: "pointer",
                            "font-weight": "bold",
                            "font-size": "10px",
                        }}
                    >
                        HARD RELOAD
                    </button>
                </div>

                <div style={{ "margin-top": "8px", "font-size": "9px", color: "#888" }}>
                    If stuck: Click HARD RELOAD or press F5
                </div>
            </div>
        </Show>
    )
}
