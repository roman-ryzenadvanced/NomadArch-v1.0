import { Component, createSignal, Show } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import OpenCodeBinarySelector from "./opencode-binary-selector"
import EnvironmentVariablesEditor from "./environment-variables-editor"
import OllamaCloudSettings from "./settings/OllamaCloudSettings"
import QwenCodeSettings from "./settings/QwenCodeSettings"
import ZAISettings from "./settings/ZAISettings"
import OpenCodeZenSettings from "./settings/OpenCodeZenSettings"

interface AdvancedSettingsModalProps {
  open: boolean
  onClose: () => void
  selectedBinary: string
  onBinaryChange: (binary: string) => void
  isLoading?: boolean
}

const AdvancedSettingsModal: Component<AdvancedSettingsModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal("general")

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="modal-overlay" />
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="modal-surface w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <header class="px-6 py-4 border-b" style={{ "border-color": "var(--border-base)" }}>
              <Dialog.Title class="text-xl font-semibold text-primary">Advanced Settings</Dialog.Title>
            </header>

            <div class="border-b" style={{ "border-color": "var(--border-base)" }}>
              <div class="flex w-full px-6 overflow-x-auto">
                <button
                  class={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab() === "zen"
                    ? "border-orange-500 text-orange-400"
                    : "border-transparent hover:border-gray-300"
                    }`}
                  onClick={() => setActiveTab("zen")}
                >
                  🆓 Free Models
                </button>
                <button
                  class={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab() === "general"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent hover:border-gray-300"
                    }`}
                  onClick={() => setActiveTab("general")}
                >
                  General
                </button>
                <button
                  class={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab() === "ollama"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent hover:border-gray-300"
                    }`}
                  onClick={() => setActiveTab("ollama")}
                >
                  Ollama Cloud
                </button>
                <button
                  class={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab() === "qwen"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent hover:border-gray-300"
                    }`}
                  onClick={() => setActiveTab("qwen")}
                >
                  Qwen Code
                </button>
                <button
                  class={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab() === "zai"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent hover:border-gray-300"
                    }`}
                  onClick={() => setActiveTab("zai")}
                >
                  Z.AI
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto">
              <Show when={activeTab() === "zen"}>
                <OpenCodeZenSettings />
              </Show>

              <Show when={activeTab() === "general"}>
                <div class="p-6 space-y-6">
                  <OpenCodeBinarySelector
                    selectedBinary={props.selectedBinary}
                    onBinaryChange={props.onBinaryChange}
                    disabled={Boolean(props.isLoading)}
                    isVisible={props.open}
                  />

                  <div class="panel">
                    <div class="panel-header">
                      <h3 class="panel-title">Environment Variables</h3>
                      <p class="panel-subtitle">Applied whenever a new OpenCode instance starts</p>
                    </div>
                    <div class="panel-body">
                      <EnvironmentVariablesEditor disabled={Boolean(props.isLoading)} />
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={activeTab() === "ollama"}>
                <OllamaCloudSettings />
              </Show>

              <Show when={activeTab() === "qwen"}>
                <QwenCodeSettings />
              </Show>

              <Show when={activeTab() === "zai"}>
                <ZAISettings />
              </Show>
            </div>

            <div class="px-6 py-4 border-t flex justify-end" style={{ "border-color": "var(--border-base)" }}>
              <button
                type="button"
                class="selector-button selector-button-secondary"
                onClick={props.onClose}
              >
                Close
              </button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}

export default AdvancedSettingsModal
