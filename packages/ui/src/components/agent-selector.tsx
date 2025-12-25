import { Select } from "@kobalte/core/select"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { agents, fetchAgents, sessions } from "../stores/sessions"
import { ChevronDown, Plus } from "lucide-solid"
import type { Agent } from "../types/session"
import { getLogger } from "../lib/logger"
import AgentCreatorDialog from "./agent-creator-dialog"

const log = getLogger("session")


interface AgentSelectorProps {
  instanceId: string
  sessionId: string
  currentAgent: string
  onAgentChange: (agent: string) => Promise<void>
}

export default function AgentSelector(props: AgentSelectorProps) {
  const instanceAgents = () => agents().get(props.instanceId) || []
  const [showCreator, setShowCreator] = createSignal(false)

  const session = createMemo(() => {
    const instanceSessions = sessions().get(props.instanceId)
    return instanceSessions?.get(props.sessionId)
  })

  const isChildSession = createMemo(() => {
    return session()?.parentId !== null && session()?.parentId !== undefined
  })

  const availableAgents = createMemo(() => {
    const allAgents = instanceAgents()
    if (isChildSession()) {
      return allAgents
    }

    const filtered = allAgents.filter((agent) => agent.mode !== "subagent")

    const currentAgent = allAgents.find((a) => a.name === props.currentAgent)
    if (currentAgent && !filtered.find((a) => a.name === props.currentAgent)) {
      return [currentAgent, ...filtered]
    }

    return filtered
  })

  createEffect(() => {
    const list = availableAgents()
    if (list.length === 0) return
    if (!list.some((agent) => agent.name === props.currentAgent)) {
      void props.onAgentChange(list[0].name)
    }
  })

  createEffect(() => {
    if (instanceAgents().length === 0) {
      fetchAgents(props.instanceId).catch((error) => log.error("Failed to fetch agents", error))
    }
  })


  const handleChange = async (value: Agent | null) => {
    if (value && value.name !== props.currentAgent) {
      await props.onAgentChange(value.name)
    }
  }

  return (
    <>
      <div class="sidebar-selector flex items-center gap-1">
        <Select
          value={availableAgents().find((a) => a.name === props.currentAgent)}
          onChange={handleChange}
          options={availableAgents()}
          optionValue="name"
          optionTextValue="name"
          placeholder="Select agent..."
          itemComponent={(itemProps) => (
            <Select.Item
              item={itemProps.item}
              class="selector-option"
            >
              <div class="flex flex-col flex-1 min-w-0">
                <Select.ItemLabel class="selector-option-label flex items-center gap-2">
                  <span>{itemProps.item.rawValue.name}</span>
                  <Show when={itemProps.item.rawValue.mode === "subagent"}>
                    <span class="neutral-badge">subagent</span>
                  </Show>
                  <Show when={itemProps.item.rawValue.mode === "custom"}>
                    <span class="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 rounded-full font-medium">custom</span>
                  </Show>
                </Select.ItemLabel>
                <Show when={itemProps.item.rawValue.description}>
                  <Select.ItemDescription class="selector-option-description">
                    {itemProps.item.rawValue.description.length > 50
                      ? itemProps.item.rawValue.description.slice(0, 50) + "..."
                      : itemProps.item.rawValue.description}
                  </Select.ItemDescription>
                </Show>
              </div>
            </Select.Item>
          )}
        >
          <Select.Trigger
            data-agent-selector
            class="selector-trigger"
          >
            <Select.Value<Agent>>
              {(state) => (
                <div class="selector-trigger-label">
                  <span class="selector-trigger-primary">
                    Agent: {state.selectedOption()?.name ?? "None"}
                  </span>
                </div>
              )}
            </Select.Value>
            <Select.Icon class="selector-trigger-icon">
              <ChevronDown class="w-3 h-3" />
            </Select.Icon>
          </Select.Trigger>

          <Select.Portal>
            <Select.Content class="selector-popover max-h-80 overflow-auto p-1">
              <Select.Listbox class="selector-listbox" />
            </Select.Content>
          </Select.Portal>
        </Select>

        {/* Add Agent Button */}
        <button
          onClick={() => setShowCreator(true)}
          class="p-1.5 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-all shrink-0"
          title="Create custom agent"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Agent Creator Dialog */}
      <AgentCreatorDialog
        instanceId={props.instanceId}
        open={showCreator()}
        onClose={() => setShowCreator(false)}
      />
    </>
  )
}
