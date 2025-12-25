/**
 * LiteModelSelector - Non-reactive model selector for MultiX v2
 * 
 * Uses polling instead of reactive subscriptions to prevent cascading updates.
 */

import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { providers } from "@/stores/session-state";
import { ChevronDown, Cpu } from "lucide-solid";

interface Model {
    id: string;
    name: string;
    providerId: string;
}

interface Provider {
    id: string;
    name: string;
    models: Model[];
}

interface LiteModelSelectorProps {
    instanceId: string;
    sessionId: string;
    currentModel: { providerId: string; modelId: string };
    onModelChange: (model: { providerId: string; modelId: string }) => void;
}

export function LiteModelSelector(props: LiteModelSelectorProps) {
    const [isOpen, setIsOpen] = createSignal(false);
    const [providerList, setProviderList] = createSignal<Provider[]>([]);

    // Load providers once on mount, then poll
    function loadProviders() {
        try {
            const instanceProviders = providers().get(props.instanceId) || [];
            setProviderList(instanceProviders.map((p: any) => ({
                id: p.id,
                name: p.name,
                models: (p.models || []).map((m: any) => ({
                    id: m.id,
                    name: m.name,
                    providerId: p.id,
                })),
            })));
        } catch (e) {
            console.warn("Failed to load providers", e);
        }
    }

    onMount(() => {
        loadProviders();
        // Poll every 10 seconds (providers don't change often)
        const interval = setInterval(loadProviders, 10000);
        onCleanup(() => clearInterval(interval));
    });

    const handleSelect = (providerId: string, modelId: string) => {
        props.onModelChange({ providerId, modelId });
        setIsOpen(false);
    };

    const getCurrentModelName = () => {
        if (!props.currentModel.modelId) return "Select Model";
        for (const provider of providerList()) {
            for (const model of provider.models) {
                if (model.id === props.currentModel.modelId) {
                    return model.name;
                }
            }
        }
        return props.currentModel.modelId;
    };

    return (
        <div class="relative">
            <button
                onClick={() => setIsOpen(!isOpen())}
                class="flex items-center justify-between w-full px-3 py-2 bg-zinc-900/60 border border-white/10 rounded-lg text-left hover:border-indigo-500/30 transition-all"
            >
                <div class="flex items-center gap-2">
                    <Cpu size={14} class="text-emerald-400" />
                    <span class="text-[11px] font-bold text-zinc-200 truncate">
                        {getCurrentModelName()}
                    </span>
                </div>
                <ChevronDown size={12} class={`text-zinc-500 transition-transform ${isOpen() ? "rotate-180" : ""}`} />
            </button>

            <Show when={isOpen()}>
                <div class="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                    <For each={providerList()}>
                        {(provider) => (
                            <div>
                                <div class="px-3 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wide bg-zinc-950/50 sticky top-0">
                                    {provider.name}
                                </div>
                                <For each={provider.models}>
                                    {(model) => (
                                        <button
                                            onClick={() => handleSelect(provider.id, model.id)}
                                            class={`w-full px-3 py-2 text-left hover:bg-white/5 transition-colors flex items-center gap-2 ${props.currentModel.modelId === model.id ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-300"
                                                }`}
                                        >
                                            <Cpu size={12} class="text-zinc-500" />
                                            <span class="text-[11px] font-medium truncate">{model.name}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        )}
                    </For>
                    <Show when={providerList().length === 0}>
                        <div class="px-3 py-2 text-[10px] text-zinc-600">No models available</div>
                    </Show>
                </div>
            </Show>
        </div>
    );
}
