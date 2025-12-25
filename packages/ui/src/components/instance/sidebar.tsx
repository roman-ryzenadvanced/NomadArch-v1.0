import { Component, createSignal, For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import {
  Files,
  Search,
  GitBranch,
  Play,
  Settings,
  Plug,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Folder,
  User,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
} from "lucide-solid"
import { serverApi } from "../../lib/api-client"
import InstanceServiceStatus from "../instance-service-status"
import McpManager from "../mcp-manager"
import { catalog, catalogLoading, catalogError, loadCatalog } from "../../stores/skills"
import { getSessionSkills, setSessionSkills } from "../../stores/session-state"

export interface FileNode {
  name: string
  type: "file" | "directory"
  path: string
  language?: string
  content?: string
  children?: FileNode[]
}

interface SidebarProps {
  instanceId: string
  onFileSelect: (file: FileNode) => void
  isOpen: boolean
  sessions: any[] // Existing sessions to display in one of the tabs
  activeSessionId?: string
  onSessionSelect: (id: string) => void
  onOpenCommandPalette?: () => void
  onToggleTerminal?: () => void
  isTerminalOpen?: boolean
  onOpenAdvancedSettings?: () => void
  requestedTab?: string | null
}

const getFileIcon = (fileName: string) => {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".ts"))
    return <FileCode size={16} class="text-blue-400" />
  if (fileName.endsWith(".json")) return <FileJson size={16} class="text-yellow-400" />
  if (fileName.endsWith(".md")) return <FileText size={16} class="text-gray-400" />
  if (fileName.endsWith(".png") || fileName.endsWith(".jpg"))
    return <ImageIcon size={16} class="text-purple-400" />
  return <FileCode size={16} class="text-blue-300" />
}

const FileTree: Component<{
  node: FileNode;
  depth: number;
  onSelect: (f: FileNode) => void;
  instanceId: string;
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(props.depth === 0)
  const [children, setChildren] = createSignal<FileNode[]>([])
  const [isLoading, setIsLoading] = createSignal(false)

  const handleClick = async () => {
    if (props.node.type === "directory") {
      const nextOpen = !isOpen()
      setIsOpen(nextOpen)

      if (nextOpen && children().length === 0) {
        setIsLoading(true)
        try {
          const entries = await serverApi.listWorkspaceFiles(props.instanceId, props.node.path)
          setChildren(entries.map(e => ({
            name: e.name,
            type: e.type,
            path: e.path
          })))
        } catch (e) {
          console.error("Failed to list files", e)
        } finally {
          setIsLoading(false)
        }
      }
    } else {
      props.onSelect(props.node)
    }
  }

  return (
    <div>
      <div
        onClick={handleClick}
        class={`flex items-center py-1 px-2 cursor-pointer hover:bg-white/5 text-zinc-400 text-sm transition-colors rounded ${props.depth > 0 ? "ml-2" : ""}`}
      >
        <span class="mr-1 w-4 flex justify-center">
          <Show when={props.node.type === "directory"}>
            <Show when={isOpen()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </Show>
        </span>
        <span class="mr-2">
          <Show
            when={props.node.type === "directory"}
            fallback={getFileIcon(props.node.name)}
          >
            <Folder size={14} class="text-blue-500/80" />
          </Show>
        </span>
        <span class={props.node.type === "directory" ? "font-medium" : ""}>{props.node.name}</span>
        <Show when={isLoading()}>
          <span class="ml-2 w-3 h-3 border border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </Show>
      </div>
      <Show when={props.node.type === "directory" && isOpen()}>
        <div class="border-l border-white/5 ml-3">
          <For each={children()}>
            {(child) => <FileTree node={child} depth={props.depth + 1} onSelect={props.onSelect} instanceId={props.instanceId} />}
          </For>
        </div>
      </Show>
    </div>
  )
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal("files")
  const [rootFiles, setRootFiles] = createSignal<FileNode[]>([])
  const [lastRequestedTab, setLastRequestedTab] = createSignal<string | null>(null)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchResults, setSearchResults] = createSignal<FileNode[]>([])
  const [searchLoading, setSearchLoading] = createSignal(false)
  const [gitStatus, setGitStatus] = createSignal<{
    isRepo: boolean
    branch: string | null
    ahead: number
    behind: number
    changes: Array<{ path: string; status: string }>
    error?: string
  } | null>(null)
  const [gitLoading, setGitLoading] = createSignal(false)
  const [skillsFilter, setSkillsFilter] = createSignal("")
  const FILE_CHANGE_EVENT = "opencode:workspace-files-changed"

  const openExternal = (url: string) => {
    if (typeof window === "undefined") return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const refreshRootFiles = async () => {
    if (!props.instanceId) return
    try {
      const entries = await serverApi.listWorkspaceFiles(props.instanceId, ".")
      setRootFiles(entries.map(e => ({
        name: e.name,
        type: e.type,
        path: e.path
      })))
    } catch (e) {
      console.error("Failed to load root files", e)
    }
  }

  createEffect(() => {
    void refreshRootFiles()
  })

  createEffect(() => {
    if (typeof window === "undefined") return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string }>).detail
      console.log(`[Sidebar] Received FILE_CHANGE_EVENT`, {
        detail,
        currentInstanceId: props.instanceId,
        match: detail?.instanceId === props.instanceId
      });
      if (!detail || detail.instanceId !== props.instanceId) return
      void refreshRootFiles()
    }
    window.addEventListener(FILE_CHANGE_EVENT, handler)
    onCleanup(() => window.removeEventListener(FILE_CHANGE_EVENT, handler))
  })

  createEffect(() => {
    if (activeTab() === "skills") {
      loadCatalog()
    }
  })

  createEffect(() => {
    const nextTab = props.requestedTab ?? null
    if (!nextTab || nextTab === lastRequestedTab()) return
    setActiveTab(nextTab)
    setLastRequestedTab(nextTab)
  })

  const filteredSkills = createMemo(() => {
    const term = skillsFilter().trim().toLowerCase()
    if (!term) return catalog()
    return catalog().filter((skill) => {
      const name = skill.name?.toLowerCase() ?? ""
      const description = skill.description?.toLowerCase() ?? ""
      return name.includes(term) || description.includes(term) || skill.id.toLowerCase().includes(term)
    })
  })

  const selectedSkills = createMemo(() => {
    if (!props.activeSessionId) return []
    return getSessionSkills(props.instanceId, props.activeSessionId)
  })

  const toggleSkillSelection = (skillId: string) => {
    if (!props.activeSessionId) return
    const current = selectedSkills()
    const exists = current.some((skill) => skill.id === skillId)
    const next = exists
      ? current.filter((skill) => skill.id !== skillId)
      : (() => {
        const found = catalog().find((skill) => skill.id === skillId)
        if (!found) return current
        return [...current, { id: found.id, name: found.name, description: found.description }]
      })()
    setSessionSkills(props.instanceId, props.activeSessionId, next)
  }

  const handleSearch = async () => {
    const query = searchQuery().trim()
    if (!query) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    try {
      const results = await serverApi.searchWorkspaceFiles(props.instanceId, query, { limit: 50, type: "all" })
      setSearchResults(
        results.map((entry) => ({
          name: entry.name,
          type: entry.type,
          path: entry.path,
        })),
      )
    } catch (error) {
      console.error("Failed to search files", error)
    } finally {
      setSearchLoading(false)
    }
  }

  const refreshGitStatus = async () => {
    setGitLoading(true)
    try {
      const status = await serverApi.fetchWorkspaceGitStatus(props.instanceId)
      setGitStatus(status)
    } catch (error) {
      setGitStatus({
        isRepo: false,
        branch: null,
        ahead: 0,
        behind: 0,
        changes: [],
        error: error instanceof Error ? error.message : "Unable to load git status",
      })
    } finally {
      setGitLoading(false)
    }
  }

  createEffect(() => {
    if (activeTab() === "git") {
      refreshGitStatus()
    }
  })

  return (
    <div
      class={`flex bg-[#111111] border-r border-white/5 transition-all duration-300 ease-in-out h-full ${props.isOpen ? "w-72" : "w-0 overflow-hidden"}`}
    >
      {/* Activity Bar */}
      <div class="w-14 border-r border-white/5 flex flex-col items-center py-4 space-y-6 shrink-0">
        <For
          each={[
            { id: "files", icon: Files },
            { id: "sessions", icon: User },
            { id: "search", icon: Search },
            { id: "git", icon: GitBranch },
            { id: "debug", icon: Play },
            { id: "mcp", icon: Plug },
            { id: "skills", icon: Sparkles },
            { id: "settings", icon: Settings },
          ]}
        >
          {(item) => (
            <button
              onClick={() => setActiveTab(item.id)}
              class={`p-2 transition-all duration-200 relative ${activeTab() === item.id ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <item.icon size={22} strokeWidth={1.5} />
              <Show when={activeTab() === item.id}>
                <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* Side Pane */}
      <div class="flex-1 flex flex-col py-3 min-w-0">
        <div class="px-4 mb-4 flex items-center justify-between">
          <h2 class="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
            {activeTab() === "files" ? "Explorer" : activeTab() === "sessions" ? "Sessions" : activeTab()}
          </h2>
        </div>
        <div class="flex-1 overflow-auto px-2">
          <Show when={activeTab() === "files"}>
            <For each={rootFiles()}>
              {(node) => <FileTree node={node} depth={0} onSelect={props.onFileSelect} instanceId={props.instanceId} />}
            </For>
          </Show>
          <Show when={activeTab() === "sessions"}>
            <div class="flex flex-col gap-1">
              <For each={props.sessions}>
                {(session) => (
                  <div
                    onClick={() => props.onSessionSelect(session.id)}
                    class={`px-3 py-1.5 rounded cursor-pointer text-sm transition-colors ${props.activeSessionId === session.id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20' : 'text-zinc-400 hover:bg-white/5'}`}
                  >
                    {session.title || session.id.slice(0, 8)}
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={activeTab() === "search"}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <input
                  value={searchQuery()}
                  onInput={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSearch()
                    }
                  }}
                  placeholder="Search files..."
                  class="flex-1 rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500/60"
                />
                <button
                  onClick={handleSearch}
                  class="px-3 py-2 text-xs font-semibold uppercase tracking-wide rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30"
                >
                  Search
                </button>
              </div>
              <Show when={searchLoading()}>
                <div class="text-xs text-zinc-500">Searching...</div>
              </Show>
              <Show when={!searchLoading() && searchResults().length === 0 && searchQuery().trim().length > 0}>
                <div class="text-xs text-zinc-500">No results found.</div>
              </Show>
              <div class="flex flex-col gap-1">
                <For each={searchResults()}>
                  {(result) => (
                    <div
                      onClick={() => props.onFileSelect(result)}
                      class="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 rounded-md hover:bg-white/5 cursor-pointer"
                    >
                      <span class="text-zinc-500">{result.type === "directory" ? "DIR" : "FILE"}</span>
                      <span class="truncate">{result.path}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={activeTab() === "git"}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-zinc-500">Repository Status</span>
                <button
                  onClick={refreshGitStatus}
                  class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide rounded-md border border-white/10 text-zinc-300 hover:text-white"
                >
                  Refresh
                </button>
              </div>
              <Show when={gitLoading()}>
                <div class="text-xs text-zinc-500">Loading git status...</div>
              </Show>
              <Show when={!gitLoading() && gitStatus()}>
                {(status) => (
                  <div class="flex flex-col gap-3">
                    <Show when={!status().isRepo}>
                      <div class="text-xs text-zinc-500">
                        {status().error ? `Git unavailable: ${status().error}` : "No git repository detected."}
                      </div>
                    </Show>
                    <Show when={status().isRepo}>
                      <div class="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200">
                        <div class="flex items-center justify-between">
                          <span class="font-semibold">{status().branch || "Detached"}</span>
                          <span class="text-zinc-500">
                            {status().ahead ? `↑${status().ahead}` : ""}
                            {status().behind ? ` ↓${status().behind}` : ""}
                          </span>
                        </div>
                        <div class="text-[11px] text-zinc-500 mt-1">
                          {status().changes.length} change{status().changes.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div class="flex flex-col gap-1">
                        <For each={status().changes}>
                          {(change) => (
                            <div class="flex items-center gap-2 text-xs text-zinc-300 px-3 py-1 rounded-md hover:bg-white/5">
                              <span class="text-zinc-500 w-6">{change.status}</span>
                              <span class="truncate">{change.path}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </Show>
          <Show when={activeTab() === "debug"}>
            <div class="flex flex-col gap-3">
              <div class="text-xs uppercase tracking-wide text-zinc-500">Tools</div>
              <button
                onClick={() => props.onOpenCommandPalette?.()}
                class="px-3 py-2 text-xs font-semibold uppercase tracking-wide rounded-md bg-white/5 border border-white/10 text-zinc-300 hover:text-white"
              >
                Open Command Palette
              </button>
              <button
                onClick={() => props.onToggleTerminal?.()}
                class="px-3 py-2 text-xs font-semibold uppercase tracking-wide rounded-md bg-white/5 border border-white/10 text-zinc-300 hover:text-white"
              >
                {props.isTerminalOpen ? "Close Terminal" : "Open Terminal"}
              </button>
            </div>
          </Show>
          <Show when={activeTab() === "mcp"}>
            <McpManager instanceId={props.instanceId} />
          </Show>
          <Show when={activeTab() === "skills"}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-zinc-500">Skills</span>
                <span class="text-[10px] text-zinc-500">
                  {selectedSkills().length} selected
                </span>
              </div>
              <Show when={!props.activeSessionId}>
                <div class="text-xs text-zinc-500">Select a session to assign skills.</div>
              </Show>
              <input
                value={skillsFilter()}
                onInput={(event) => setSkillsFilter(event.currentTarget.value)}
                placeholder="Filter skills..."
                class="rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/60"
              />
              <Show when={catalogLoading()}>
                <div class="text-xs text-zinc-500">Loading skills...</div>
              </Show>
              <Show when={catalogError()}>
                {(error) => <div class="text-xs text-amber-400">{error()}</div>}
              </Show>
              <div class="flex flex-col gap-2">
                <For each={filteredSkills()}>
                  {(skill) => {
                    const isSelected = () => selectedSkills().some((item) => item.id === skill.id)
                    return (
                      <button
                        type="button"
                        onClick={() => toggleSkillSelection(skill.id)}
                        class={`w-full text-left px-3 py-2 rounded-md border transition-colors ${isSelected()
                            ? "border-blue-500/60 bg-blue-500/10 text-blue-200"
                            : "border-white/10 bg-white/5 text-zinc-300 hover:text-white"
                          }`}
                      >
                        <div class="text-xs font-semibold">{skill.name}</div>
                        <Show when={skill.description}>
                          <div class="text-[11px] text-zinc-500 mt-1">{skill.description}</div>
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>
          <Show when={activeTab() === "settings"}>
            <div class="flex flex-col gap-3">
              <div class="text-xs uppercase tracking-wide text-zinc-500">Settings</div>
              <button
                onClick={() => props.onOpenAdvancedSettings?.()}
                class="px-3 py-2 text-xs font-semibold uppercase tracking-wide rounded-md bg-white/5 border border-white/10 text-zinc-300 hover:text-white"
              >
                Open Advanced Settings
              </button>
              <button
                onClick={() => props.onOpenCommandPalette?.()}
                class="px-3 py-2 text-xs font-semibold uppercase tracking-wide rounded-md bg-white/5 border border-white/10 text-zinc-300 hover:text-white"
              >
                Open Command Palette
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
