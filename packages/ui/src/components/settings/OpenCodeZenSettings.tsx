import { Component, createSignal, onMount, For, Show } from 'solid-js'
import { Zap, CheckCircle, XCircle, Loader, Sparkles } from 'lucide-solid'

interface ZenModel {
    id: string
    name: string
    family?: string
    free: boolean
    reasoning?: boolean
    tool_call?: boolean
    limit?: {
        context: number
        output: number
    }
}

const OpenCodeZenSettings: Component = () => {
    const [models, setModels] = createSignal<ZenModel[]>([])
    const [isLoading, setIsLoading] = createSignal(true)
    const [connectionStatus, setConnectionStatus] = createSignal<'idle' | 'testing' | 'connected' | 'failed'>('idle')
    const [error, setError] = createSignal<string | null>(null)

    // Load models on mount
    onMount(async () => {
        await loadModels()
        await testConnection()
    })

    const loadModels = async () => {
        setIsLoading(true)
        try {
            const response = await fetch('/api/opencode-zen/models')
            if (response.ok) {
                const data = await response.json()
                setModels(data.models || [])
                setError(null)
            } else {
                throw new Error('Failed to load models')
            }
        } catch (err) {
            console.error('Failed to load OpenCode Zen models:', err)
            setError('Failed to load models')
        } finally {
            setIsLoading(false)
        }
    }

    const testConnection = async () => {
        setConnectionStatus('testing')
        try {
            const response = await fetch('/api/opencode-zen/test')
            if (response.ok) {
                const data = await response.json()
                setConnectionStatus(data.connected ? 'connected' : 'failed')
            } else {
                setConnectionStatus('failed')
            }
        } catch (err) {
            setConnectionStatus('failed')
        }
    }

    const formatNumber = (num: number): string => {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
        if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
        return num.toString()
    }

    return (
        <div class="space-y-6 p-6">
            {/* Header */}
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-gradient-to-br from-orange-500/20 to-yellow-500/20 rounded-lg">
                        <Zap class="w-6 h-6 text-orange-400" />
                    </div>
                    <div>
                        <h2 class="text-xl font-semibold text-white">OpenCode Zen</h2>
                        <p class="text-sm text-zinc-400">Free AI models - No API key required!</p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    {connectionStatus() === 'testing' && (
                        <span class="flex items-center gap-2 text-sm text-zinc-400">
                            <Loader class="w-4 h-4 animate-spin" />
                            Testing...
                        </span>
                    )}
                    {connectionStatus() === 'connected' && (
                        <span class="flex items-center gap-2 text-sm text-emerald-400">
                            <CheckCircle class="w-4 h-4" />
                            Connected
                        </span>
                    )}
                    {connectionStatus() === 'failed' && (
                        <span class="flex items-center gap-2 text-sm text-red-400">
                            <XCircle class="w-4 h-4" />
                            Offline
                        </span>
                    )}
                </div>
            </div>

            {/* Info Banner */}
            <div class="bg-gradient-to-r from-orange-500/10 via-yellow-500/10 to-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                <div class="flex items-start gap-3">
                    <Sparkles class="w-5 h-5 text-orange-400 mt-0.5" />
                    <div>
                        <h3 class="font-semibold text-orange-300 mb-1">Free Models Available!</h3>
                        <p class="text-sm text-zinc-300">
                            OpenCode Zen provides access to powerful AI models completely free of charge.
                            These models are ready to use immediately - no API keys or authentication required!
                        </p>
                    </div>
                </div>
            </div>

            {/* Models Grid */}
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-medium text-white">Available Free Models</h3>
                    <button
                        onClick={loadModels}
                        disabled={isLoading()}
                        class="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                        {isLoading() ? <Loader class="w-4 h-4 animate-spin" /> : null}
                        Refresh
                    </button>
                </div>

                <Show when={error()}>
                    <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                        {error()}
                    </div>
                </Show>

                <Show when={isLoading()}>
                    <div class="flex items-center justify-center py-12">
                        <div class="flex items-center gap-3 text-zinc-400">
                            <Loader class="w-6 h-6 animate-spin" />
                            <span>Loading models...</span>
                        </div>
                    </div>
                </Show>

                <Show when={!isLoading() && models().length > 0}>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <For each={models()}>
                            {(model) => (
                                <div class="group bg-zinc-900/50 border border-zinc-800 hover:border-orange-500/50 rounded-xl p-4 transition-all">
                                    <div class="flex items-start justify-between mb-3">
                                        <div>
                                            <h4 class="font-semibold text-white group-hover:text-orange-300 transition-colors">
                                                {model.name}
                                            </h4>
                                            <p class="text-xs text-zinc-500 font-mono">{model.id}</p>
                                        </div>
                                        <span class="px-2 py-0.5 text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 rounded">
                                            FREE
                                        </span>
                                    </div>

                                    <div class="flex flex-wrap gap-2 mb-3">
                                        {model.reasoning && (
                                            <span class="px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                                                Reasoning
                                            </span>
                                        )}
                                        {model.tool_call && (
                                            <span class="px-2 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">
                                                Tool Use
                                            </span>
                                        )}
                                        {model.family && (
                                            <span class="px-2 py-0.5 text-[10px] bg-zinc-700 text-zinc-400 rounded">
                                                {model.family}
                                            </span>
                                        )}
                                    </div>

                                    {model.limit && (
                                        <div class="flex items-center gap-4 text-xs text-zinc-500">
                                            <span>Context: {formatNumber(model.limit.context)}</span>
                                            <span>Output: {formatNumber(model.limit.output)}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={!isLoading() && models().length === 0 && !error()}>
                    <div class="text-center py-12 text-zinc-500">
                        <p>No free models available at this time.</p>
                        <button
                            onClick={loadModels}
                            class="mt-4 px-4 py-2 text-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg transition-colors"
                        >
                            Try Again
                        </button>
                    </div>
                </Show>
            </div>

            {/* Usage Info */}
            <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <h4 class="font-medium text-white mb-2">How to Use</h4>
                <ul class="text-sm text-zinc-400 space-y-1">
                    <li>• Select any Zen model from the model picker in chat</li>
                    <li>• No API key configuration needed - just start chatting!</li>
                    <li>• Models support streaming, reasoning, and tool use</li>
                    <li>• Rate limits may apply during high demand periods</li>
                </ul>
            </div>
        </div>
    )
}

export default OpenCodeZenSettings
