import { createMemo, createSignal, For, Show } from "solid-js"
import { providers, fetchProviders } from "../stores/sessions"
import { ChevronDown, ShieldCheck, Cpu } from "lucide-solid"
import type { Model, Provider } from "../types/session"
import { Popover } from "@kobalte/core/popover"

interface ModelStatusSelectorProps {
  instanceId: string
  sessionId: string
  currentModel: { providerId: string; modelId: string }
  onModelChange: (model: { providerId: string; modelId: string }) => Promise<void>
}

export default function ModelStatusSelector(props: ModelStatusSelectorProps) {
  const instanceProviders = () => providers().get(props.instanceId) || []
  const [isOpen, setIsOpen] = createSignal(false)

  const currentProvider = createMemo(() => 
    instanceProviders().find(p => p.id === props.currentModel.providerId)
  )

  const currentModel = createMemo(() => 
    currentProvider()?.models.find(m => m.id === props.currentModel.modelId)
  )

  // Simple auth status check: if we have providers and the current provider is in the list, we consider it "authenticated"
  const isAuthenticated = createMemo(() => !!currentProvider())

  return (
    <div class="flex items-center space-x-2">
      {/* Auth Status Indicator */}
      <div class="flex items-center bg-white/5 border border-white/5 rounded-full px-2 py-1 space-x-1.5 h-[26px]">
        <div class={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isAuthenticated() ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]'}`} />
        <span class="text-[9px] font-black uppercase tracking-widest text-zinc-500 whitespace-nowrap">
          {isAuthenticated() ? 'AUTHED' : 'NO AUTH'}
        </span>
      </div>

      {/* Model Selector HUD */}
      <Popover open={isOpen()} onOpenChange={setIsOpen}>
        <Popover.Trigger class="flex items-center bg-white/5 border border-white/5 rounded-full px-3 py-1 space-x-2 text-zinc-400 hover:border-white/10 hover:bg-white/10 transition-all group h-[26px]">
          <Cpu size={12} class="text-indigo-400 shrink-0" />
          <div class="flex flex-col items-start leading-none">
            <span class="text-[8px] font-black text-zinc-500 uppercase tracking-widest">AI MODEL</span>
            <span class="text-[10px] font-bold text-zinc-200 truncate max-w-[100px]">
              {currentModel()?.name ?? currentProvider()?.name ?? "Select Model"}
            </span>
          </div>
          <ChevronDown size={10} class={`transition-transform duration-200 shrink-0 ${isOpen() ? 'rotate-180' : ''}`} />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content class="z-[1000] min-w-[240px] bg-[#0c0c0d] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 p-2 animate-in fade-in zoom-in-95 duration-200 origin-top">
            <div class="max-h-[400px] overflow-y-auto custom-scrollbar no-scrollbar">
              <For each={instanceProviders()}>
                {(provider) => (
                  <div class="mb-2 last:mb-0">
                    <div class="px-2 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest flex items-center justify-between border-b border-white/5 mb-1">
                      <span>{provider.name}</span>
                      <Show when={provider.id === props.currentModel.providerId}>
                        <ShieldCheck size={10} class="text-emerald-500/50" />
                      </Show>
                    </div>
                    <div class="space-y-0.5">
                      <For each={provider.models}>
                        {(model) => (
                          <button
                            onClick={async () => {
                              await props.onModelChange({ providerId: provider.id, modelId: model.id })
                              setIsOpen(false)
                            }}
                            class={`w-full flex items-center justify-between px-2 py-2 rounded-lg text-[11px] transition-all border ${
                              model.id === props.currentModel.modelId && provider.id === props.currentModel.providerId
                                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20'
                                : 'text-zinc-400 hover:bg-white/5 border-transparent'
                            }`}
                          >
                            <span class="font-bold">{model.name}</span>
                            <Show when={model.id === props.currentModel.modelId && provider.id === props.currentModel.providerId}>
                              <div class="w-1 h-1 bg-indigo-400 rounded-full animate-pulse" />
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  )
}
