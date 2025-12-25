import { Combobox } from "@kobalte/core/combobox"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { providers, fetchProviders } from "../stores/sessions"
import { ChevronDown, Database } from "lucide-solid"
import type { Model } from "../types/session"
import { getLogger } from "../lib/logger"
import { getUserScopedKey } from "../lib/user-storage"
const log = getLogger("session")

const OPENCODE_ZEN_OFFLINE_STORAGE_KEY = "opencode-zen-offline-models"

interface ModelSelectorProps {
  instanceId: string
  sessionId: string
  currentModel: { providerId: string; modelId: string }
  onModelChange: (model: { providerId: string; modelId: string }) => Promise<void>
}

interface FlatModel extends Model {
  providerName: string
  key: string
  searchText: string
}

import { useQwenOAuth } from "../lib/integrations/qwen-oauth"

export default function ModelSelector(props: ModelSelectorProps) {
  const instanceProviders = () => providers().get(props.instanceId) || []
  const [isOpen, setIsOpen] = createSignal(false)
  const qwenAuth = useQwenOAuth()
  const [offlineModels, setOfflineModels] = createSignal<Set<string>>(new Set())

  // Context-Engine status: "stopped" | "ready" | "indexing" | "error"
  type ContextEngineStatus = "stopped" | "ready" | "indexing" | "error"
  const [contextEngineStatus, setContextEngineStatus] = createSignal<ContextEngineStatus>("stopped")

  let triggerRef!: HTMLButtonElement
  let searchInputRef!: HTMLInputElement

  createEffect(() => {
    if (instanceProviders().length === 0) {
      fetchProviders(props.instanceId).catch((error) => log.error("Failed to fetch providers", error))
    }
  })

  const readOfflineModels = () => {
    if (typeof window === "undefined") return new Set<string>()
    try {
      const raw = window.localStorage.getItem(getUserScopedKey(OPENCODE_ZEN_OFFLINE_STORAGE_KEY))
      const parsed = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [])
    } catch {
      return new Set<string>()
    }
  }

  const refreshOfflineModels = () => {
    setOfflineModels(readOfflineModels())
  }

  onMount(() => {
    refreshOfflineModels()
    if (typeof window === "undefined") return
    const handleCustom = () => refreshOfflineModels()
    const handleStorage = (event: StorageEvent) => {
      if (event.key === getUserScopedKey(OPENCODE_ZEN_OFFLINE_STORAGE_KEY)) {
        refreshOfflineModels()
      }
    }
    window.addEventListener("opencode-zen-offline-models", handleCustom as EventListener)
    window.addEventListener("storage", handleStorage)

    // DISABLED: Context-Engine polling was causing performance issues
    // const pollContextEngine = async () => {
    //   try {
    //     const response = await fetch("/api/context-engine/status")
    //     if (response.ok) {
    //       const data = await response.json() as { status: ContextEngineStatus }
    //       setContextEngineStatus(data.status ?? "stopped")
    //     } else {
    //       setContextEngineStatus("stopped")
    //     }
    //   } catch {
    //     setContextEngineStatus("stopped")
    //   }
    // }
    // pollContextEngine()
    // const pollInterval = setInterval(pollContextEngine, 5000)

    onCleanup(() => {
      window.removeEventListener("opencode-zen-offline-models", handleCustom as EventListener)
      window.removeEventListener("storage", handleStorage)
      // clearInterval(pollInterval)
    })
  })

  const isOfflineModel = (model: FlatModel) =>
    model.providerId === "opencode-zen" && offlineModels().has(model.id)

  const allModels = createMemo<FlatModel[]>(() =>
    instanceProviders().flatMap((p) =>
      p.models.map((m) => ({
        ...m,
        providerName: p.name,
        key: `${m.providerId}/${m.id}`,
        searchText: `${m.name} ${p.name} ${m.providerId} ${m.id} ${m.providerId}/${m.id}`,
      })),
    ),
  )

  const currentModelValue = createMemo(() =>
    allModels().find((m) => m.providerId === props.currentModel.providerId && m.id === props.currentModel.modelId),
  )

  const handleChange = async (value: FlatModel | null) => {
    if (!value) return

    // Auto-trigger Qwen OAuth if needed
    if (value.providerId === 'qwen-oauth' && !qwenAuth.isAuthenticated()) {
      const confirmed = window.confirm("Qwen Code requires authentication. Sign in now?")
      if (confirmed) {
        try {
          await qwenAuth.signIn()
        } catch (error) {
          log.error("Qwen authentication failed", error)
          // Continue to set model even if auth failed, to allow user to try again later
          // or user might have authenticatd in another tab
        }
      }
    }

    await props.onModelChange({ providerId: value.providerId, modelId: value.id })
  }

  const customFilter = (option: FlatModel, inputValue: string) => {
    return option.searchText.toLowerCase().includes(inputValue.toLowerCase())
  }

  createEffect(() => {
    if (isOpen()) {
      setTimeout(() => {
        searchInputRef?.focus()
      }, 100)
    }
  })

  return (
    <div class="sidebar-selector">
      <Combobox<FlatModel>
        value={currentModelValue()}
        onChange={handleChange}
        onOpenChange={setIsOpen}
        options={allModels()}
        optionValue="key"
        optionTextValue="searchText"
        optionLabel="name"
        placeholder="Search models..."
        defaultFilter={customFilter}
        allowsEmptyCollection
        itemComponent={(itemProps) => (
          <Combobox.Item
            item={itemProps.item}
            class="selector-option"
          >
            <div class="selector-option-content">
              <Combobox.ItemLabel class="selector-option-label flex items-center gap-2">
                <span class="truncate">{itemProps.item.rawValue.name}</span>
                {isOfflineModel(itemProps.item.rawValue) && (
                  <span class="selector-badge selector-badge-warning">Offline</span>
                )}
              </Combobox.ItemLabel>
              <Combobox.ItemDescription class="selector-option-description">
                {itemProps.item.rawValue.providerName} • {itemProps.item.rawValue.providerId}/
                {itemProps.item.rawValue.id}
              </Combobox.ItemDescription>
            </div>
            <Combobox.ItemIndicator class="selector-option-indicator">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      >
        <Combobox.Control class="relative w-full" data-model-selector-control>
          <Combobox.Input class="sr-only" data-model-selector />
          <Combobox.Trigger
            ref={triggerRef}
            class="selector-trigger"
          >
            <div class="selector-trigger-label selector-trigger-label--stacked">
              <span class="selector-trigger-primary selector-trigger-primary--align-left flex items-center gap-2">
                <span class="truncate">Model: {currentModelValue()?.name ?? "None"}</span>
                {currentModelValue() && isOfflineModel(currentModelValue() as FlatModel) && (
                  <span class="selector-badge selector-badge-warning">Offline</span>
                )}
                {/* Context-Engine RAG Status Indicator */}
                <Show when={contextEngineStatus() !== "stopped"}>
                  <span
                    class="inline-flex items-center gap-1 text-[10px]"
                    title={
                      contextEngineStatus() === "ready"
                        ? "Context Engine is active - RAG enabled"
                        : contextEngineStatus() === "indexing"
                          ? "Context Engine is indexing files..."
                          : "Context Engine error"
                    }
                  >
                    <span
                      class={`w-2 h-2 rounded-full ${contextEngineStatus() === "ready"
                        ? "bg-emerald-500"
                        : contextEngineStatus() === "indexing"
                          ? "bg-blue-500 animate-pulse"
                          : "bg-red-500"
                        }`}
                    />
                    <Database class="w-3 h-3 text-zinc-400" />
                  </span>
                </Show>
              </span>
              {currentModelValue() && (
                <span class="selector-trigger-secondary">
                  {currentModelValue()!.providerId}/{currentModelValue()!.id}
                </span>
              )}
            </div>
            <Combobox.Icon class="selector-trigger-icon">
              <ChevronDown class="w-3 h-3" />
            </Combobox.Icon>
          </Combobox.Trigger>
        </Combobox.Control>

        <Combobox.Portal>
          <Combobox.Content class="selector-popover">
            <div class="selector-search-container">
              <Combobox.Input
                ref={searchInputRef}
                class="selector-search-input"
                placeholder="Search models..."
              />
            </div>
            <Combobox.Listbox class="selector-listbox" />
          </Combobox.Content>
        </Combobox.Portal>
      </Combobox>
    </div>
  )
}
