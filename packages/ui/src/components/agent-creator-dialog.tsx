import { Dialog } from "@kobalte/core/dialog"
import { Bot, Loader2, Sparkles, X } from "lucide-solid"
import { Component, Show, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import { updateInstanceConfig } from "../stores/instance-config"
import { fetchAgents } from "../stores/sessions"
import { showToastNotification } from "../lib/notifications"
import { getLogger } from "../lib/logger"

const log = getLogger("agent-creator")

const MAX_PROMPT_LENGTH = 30000

interface AgentCreatorDialogProps {
    instanceId: string
    open: boolean
    onClose: () => void
}

const AgentCreatorDialog: Component<AgentCreatorDialogProps> = (props) => {
    const [name, setName] = createSignal("")
    const [description, setDescription] = createSignal("")
    const [prompt, setPrompt] = createSignal("")
    const [isGenerating, setIsGenerating] = createSignal(false)
    const [isSaving, setIsSaving] = createSignal(false)
    const [useAiGeneration, setUseAiGeneration] = createSignal(true)

    const resetForm = () => {
        setName("")
        setDescription("")
        setPrompt("")
        setIsGenerating(false)
        setUseAiGeneration(true)
    }

    const handleClose = () => {
        resetForm()
        props.onClose()
    }

    const generatePromptWithAI = async () => {
        if (!name().trim() || !description().trim()) {
            showToastNotification({
                title: "Missing Information",
                message: "Please provide both name and description to generate an agent prompt.",
                variant: "warning",
                duration: 5000,
            })
            return
        }

        setIsGenerating(true)
        try {
            // Use Z.AI or another endpoint to generate the prompt
            const response = await fetch("/api/zai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "glm-4.5-flash",
                    messages: [
                        {
                            role: "system",
                            content: `You are an expert AI agent prompt designer. Generate a comprehensive, detailed system prompt for an AI coding assistant agent based on the user's requirements. The prompt should:
1. Define the agent's role and expertise
2. Specify its capabilities and limitations
3. Include guidelines for code style and best practices
4. Define how it should interact with users
5. Include any domain-specific knowledge relevant to the description

Output ONLY the agent system prompt, no explanations or markdown formatting.`,
                        },
                        {
                            role: "user",
                            content: `Create a system prompt for an AI coding agent with the following details:

Name: ${name()}
Purpose: ${description()}

Generate a comprehensive system prompt that will make this agent effective at its purpose.`,
                        },
                    ],
                    stream: false,
                    max_tokens: 4096,
                }),
            })

            if (!response.ok) {
                throw new Error(`Generation failed: ${response.status}`)
            }

            const data = await response.json()
            const generatedPrompt = data?.choices?.[0]?.message?.content || data?.message?.content || ""

            if (generatedPrompt) {
                setPrompt(generatedPrompt)
                showToastNotification({
                    title: "Prompt Generated",
                    message: "AI has generated a system prompt for your agent. Review and edit as needed.",
                    variant: "success",
                    duration: 5000,
                })
            } else {
                throw new Error("No prompt content in response")
            }
        } catch (error) {
            log.error("Failed to generate agent prompt", error)
            showToastNotification({
                title: "Generation Failed",
                message: "Could not generate prompt. Please write one manually or check your Z.AI configuration.",
                variant: "error",
                duration: 8000,
            })
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSave = async () => {
        if (!name().trim()) {
            showToastNotification({
                title: "Name Required",
                message: "Please provide a name for the agent.",
                variant: "warning",
                duration: 5000,
            })
            return
        }

        if (!prompt().trim()) {
            showToastNotification({
                title: "Prompt Required",
                message: "Please provide a system prompt for the agent.",
                variant: "warning",
                duration: 5000,
            })
            return
        }

        setIsSaving(true)
        try {
            await updateInstanceConfig(props.instanceId, (draft) => {
                if (!draft.customAgents) {
                    draft.customAgents = []
                }
                // Check for duplicate names
                const existing = draft.customAgents.findIndex((a) => a.name.toLowerCase() === name().toLowerCase())
                if (existing >= 0) {
                    // Update existing
                    draft.customAgents[existing] = {
                        name: name().trim(),
                        description: description().trim() || undefined,
                        prompt: prompt().trim(),
                    }
                } else {
                    // Add new
                    draft.customAgents.push({
                        name: name().trim(),
                        description: description().trim() || undefined,
                        prompt: prompt().trim(),
                    })
                }
            })

            // Refresh agents list
            await fetchAgents(props.instanceId)

            showToastNotification({
                title: "Agent Created",
                message: `Custom agent "${name()}" has been saved and is ready to use.`,
                variant: "success",
                duration: 5000,
            })

            handleClose()
        } catch (error) {
            log.error("Failed to save custom agent", error)
            showToastNotification({
                title: "Save Failed",
                message: "Could not save the agent. Please try again.",
                variant: "error",
                duration: 8000,
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={(open) => !open && handleClose()}>
            <Portal>
                <Dialog.Overlay class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998]" />
                <div class="fixed inset-0 flex items-center justify-center z-[9999] p-4">
                    <Dialog.Content class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                        {/* Header */}
                        <div class="flex items-center justify-between p-4 border-b border-zinc-700/50">
                            <div class="flex items-center gap-3">
                                <div class="p-2 bg-indigo-500/20 rounded-lg">
                                    <Bot size={20} class="text-indigo-400" />
                                </div>
                                <div>
                                    <Dialog.Title class="text-lg font-semibold text-white">Create Custom Agent</Dialog.Title>
                                    <Dialog.Description class="text-xs text-zinc-400">
                                        Define a new AI agent with custom behavior and expertise
                                    </Dialog.Description>
                                </div>
                            </div>
                            <button
                                onClick={handleClose}
                                class="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded-lg transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div class="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* Name Input */}
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-zinc-300">Agent Name *</label>
                                <input
                                    type="text"
                                    value={name()}
                                    onInput={(e) => setName(e.currentTarget.value)}
                                    placeholder="e.g., React Specialist, Python Expert, Code Reviewer..."
                                    class="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                                />
                            </div>

                            {/* Description Input */}
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-zinc-300">Brief Description</label>
                                <input
                                    type="text"
                                    value={description()}
                                    onInput={(e) => setDescription(e.currentTarget.value)}
                                    placeholder="A few words about what this agent specializes in..."
                                    class="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                                />
                            </div>

                            {/* Generation Mode Toggle */}
                            <div class="flex items-center gap-4 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                                <button
                                    onClick={() => setUseAiGeneration(true)}
                                    class={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${useAiGeneration()
                                            ? "bg-indigo-500 text-white"
                                            : "text-zinc-400 hover:text-white hover:bg-zinc-700/50"
                                        }`}
                                >
                                    <Sparkles size={14} class="inline-block mr-1.5" />
                                    AI Generate
                                </button>
                                <button
                                    onClick={() => setUseAiGeneration(false)}
                                    class={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${!useAiGeneration()
                                            ? "bg-indigo-500 text-white"
                                            : "text-zinc-400 hover:text-white hover:bg-zinc-700/50"
                                        }`}
                                >
                                    Write Manually
                                </button>
                            </div>

                            {/* AI Generation Button */}
                            <Show when={useAiGeneration()}>
                                <button
                                    onClick={generatePromptWithAI}
                                    disabled={isGenerating() || !name().trim() || !description().trim()}
                                    class="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <Show when={isGenerating()} fallback={<><Sparkles size={16} /> Generate Agent Prompt with AI</>}>
                                        <Loader2 size={16} class="animate-spin" />
                                        Generating...
                                    </Show>
                                </button>
                            </Show>

                            {/* Prompt Textarea */}
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                    <label class="text-xs font-medium text-zinc-300">System Prompt *</label>
                                    <span class="text-xs text-zinc-500">
                                        {prompt().length.toLocaleString()} / {MAX_PROMPT_LENGTH.toLocaleString()}
                                    </span>
                                </div>
                                <textarea
                                    value={prompt()}
                                    onInput={(e) => {
                                        const value = e.currentTarget.value
                                        if (value.length <= MAX_PROMPT_LENGTH) {
                                            setPrompt(value)
                                        }
                                    }}
                                    placeholder="Enter the system prompt that defines this agent's behavior, expertise, and guidelines..."
                                    rows={12}
                                    class="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none font-mono text-sm"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div class="flex items-center justify-end gap-3 p-4 border-t border-zinc-700/50 bg-zinc-800/30">
                            <button
                                onClick={handleClose}
                                class="px-4 py-2 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded-lg text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving() || !name().trim() || !prompt().trim()}
                                class="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                <Show when={isSaving()} fallback={<>Save Agent</>}>
                                    <Loader2 size={14} class="animate-spin" />
                                    Saving...
                                </Show>
                            </button>
                        </div>
                    </Dialog.Content>
                </div>
            </Portal>
        </Dialog>
    )
}

export default AgentCreatorDialog
