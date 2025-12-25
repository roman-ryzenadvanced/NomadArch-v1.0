import { Dialog } from "@kobalte/core/dialog"
import { ChevronDown, ExternalLink, Plus, RefreshCw, Search, Settings } from "lucide-solid"
import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { serverApi } from "../lib/api-client"
import { getLogger } from "../lib/logger"
import InstanceServiceStatus from "./instance-service-status"
import { useOptionalInstanceMetadataContext } from "../lib/contexts/instance-metadata-context"

type McpServerConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  // Remote MCP server support
  type?: "remote" | "http" | "sse" | "streamable-http"
  url?: string
  headers?: Record<string, string>
}

type McpConfig = {
  mcpServers?: Record<string, McpServerConfig>
}

type McpMarketplaceEntry = {
  id: string
  name: string
  description: string
  config: McpServerConfig
  tags?: string[]
  source?: string
  requiresApiKey?: boolean
}


interface McpManagerProps {
  instanceId: string
}

const log = getLogger("mcp-manager")

const MCP_LINKER_RELEASES = "https://github.com/milisp/mcp-linker/releases"
const MCP_LINKER_MARKET = "https://github.com/milisp/mcp-linker"
const MARKETPLACE_ENTRIES: McpMarketplaceEntry[] = [
  {
    id: "zread",
    name: "Zread (Z.AI)",
    description: "Search GitHub repos, read code, analyze structure. Powered by Z.AI - requires API key from z.ai/manage-apikey.",
    config: {
      type: "remote",
      url: "https://api.z.ai/api/mcp/zread/mcp",
      headers: { "Authorization": "Bearer YOUR_ZAI_API_KEY" }
    },
    tags: ["github", "code", "search", "z.ai"],
    source: "z.ai",
    requiresApiKey: true,
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Step-by-step reasoning scratchpad for complex tasks.",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
    tags: ["reasoning", "planning"],
    source: "curated",
  },
  {
    id: "desktop-commander",
    name: "Desktop Commander",
    description: "Control local desktop actions and automation.",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-desktop-commander"] },
    tags: ["automation", "local"],
    source: "curated",
  },
  {
    id: "web-reader",
    name: "Web Reader",
    description: "Fetch and summarize web pages with structured metadata.",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-web-reader"] },
    tags: ["web", "search"],
    source: "curated",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Query GitHub repos, issues, and pull requests.",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    tags: ["git", "productivity"],
    source: "curated",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Inspect PostgreSQL schemas and run safe queries.",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"] },
    tags: ["database"],
    source: "curated",
  },
]


const McpManager: Component<McpManagerProps> = (props) => {
  const [config, setConfig] = createSignal<McpConfig>({ mcpServers: {} })
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [showManual, setShowManual] = createSignal(false)
  const [showMarketplace, setShowMarketplace] = createSignal(false)
  const [marketplaceQuery, setMarketplaceQuery] = createSignal("")
  const [marketplaceLoading, setMarketplaceLoading] = createSignal(false)
  const [marketplaceEntries, setMarketplaceEntries] = createSignal<McpMarketplaceEntry[]>([])
  const [rawMode, setRawMode] = createSignal(false)
  const [serverName, setServerName] = createSignal("")
  const [serverJson, setServerJson] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const metadataContext = useOptionalInstanceMetadataContext()
  const metadata = createMemo(() => metadataContext?.metadata?.() ?? null)
  const mcpStatus = createMemo(() => metadata()?.mcpStatus ?? {})

  const servers = createMemo(() => Object.entries(config().mcpServers ?? {}))
  const filteredMarketplace = createMemo(() => {
    const combined = [...MARKETPLACE_ENTRIES, ...marketplaceEntries()]
    const query = marketplaceQuery().trim().toLowerCase()
    if (!query) return combined
    return combined.filter((entry) => {
      const haystack = `${entry.name} ${entry.description} ${entry.id} ${(entry.tags || []).join(" ")}`.toLowerCase()
      return haystack.includes(query)
    })
  })

  const loadConfig = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await serverApi.fetchWorkspaceMcpConfig(props.instanceId)
      setConfig((data.config ?? { mcpServers: {} }) as McpConfig)
    } catch (err) {
      log.error("Failed to load MCP config", err)
      setError("Failed to load MCP configuration.")
    } finally {
      setIsLoading(false)
    }
  }

  createEffect(() => {
    void loadConfig()
  })

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener")
  }

  const resetManualForm = () => {
    setServerName("")
    setServerJson("")
    setRawMode(false)
  }

  const handleManualSave = async () => {
    if (saving()) return
    setSaving(true)
    setError(null)
    try {
      const parsed = JSON.parse(serverJson() || "{}")
      const nextConfig: McpConfig = { ...(config() ?? {}) }
      const mcpServers = { ...(nextConfig.mcpServers ?? {}) }

      if (rawMode()) {
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Raw config must be a JSON object.")
        }
        setConfig(parsed as McpConfig)
        await serverApi.updateWorkspaceMcpConfig(props.instanceId, parsed)
      } else {
        const name = serverName().trim()
        if (!name) {
          throw new Error("Server name is required.")
        }
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Server config must be a JSON object.")
        }
        mcpServers[name] = parsed as McpServerConfig
        nextConfig.mcpServers = mcpServers
        setConfig(nextConfig)
        await serverApi.updateWorkspaceMcpConfig(props.instanceId, nextConfig)
      }

      resetManualForm()
      setShowManual(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid MCP configuration."
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleMarketplaceInstall = async (entry: McpMarketplaceEntry) => {
    if (saving()) return
    setSaving(true)
    setError(null)
    try {
      const nextConfig: McpConfig = { ...(config() ?? {}) }
      const mcpServers = { ...(nextConfig.mcpServers ?? {}) }
      mcpServers[entry.id] = entry.config
      nextConfig.mcpServers = mcpServers
      setConfig(nextConfig)
      await serverApi.updateWorkspaceMcpConfig(props.instanceId, nextConfig)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to install MCP server."
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const fetchNpmEntries = async (query: string, sourceLabel: string): Promise<McpMarketplaceEntry[]> => {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=50`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceLabel} MCP entries`)
    }
    const data = await response.json() as {
      objects?: Array<{ package?: { name?: string; description?: string; keywords?: string[] } }>
    }
    const objects = Array.isArray(data.objects) ? data.objects : []
    return objects
      .map((entry) => entry.package)
      .filter((pkg): pkg is { name: string; description?: string; keywords?: string[] } => Boolean(pkg?.name))
      .map((pkg) => ({
        id: pkg.name,
        name: pkg.name.replace(/^@modelcontextprotocol\/server-/, ""),
        description: pkg.description || "Community MCP server package",
        config: { command: "npx", args: ["-y", pkg.name] },
        tags: pkg.keywords,
        source: sourceLabel,
      }))
  }

  const loadMarketplace = async () => {
    if (marketplaceLoading()) return
    setMarketplaceLoading(true)
    try {
      const [official, community] = await Promise.allSettled([
        fetchNpmEntries("@modelcontextprotocol/server", "npm:official"),
        fetchNpmEntries("mcp server", "npm:community"),
      ])

      const next: McpMarketplaceEntry[] = []
      if (official.status === "fulfilled") next.push(...official.value)
      if (community.status === "fulfilled") next.push(...community.value)

      const deduped = new Map<string, McpMarketplaceEntry>()
      for (const entry of next) {
        if (!deduped.has(entry.id)) deduped.set(entry.id, entry)
      }
      setMarketplaceEntries(Array.from(deduped.values()))
    } catch (err) {
      log.error("Failed to load marketplace", err)
      setError("Failed to load marketplace sources.")
    } finally {
      setMarketplaceLoading(false)
    }
  }

  return (
    <div class="mcp-manager">
      <div class="mcp-manager-header">
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-wide text-zinc-500">MCP Servers</span>
          <button
            onClick={loadConfig}
            class="mcp-icon-button"
            title="Refresh MCP servers"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div class="mcp-manager-actions">
          <div class="relative">
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              class="mcp-action-button"
              title="Add MCP"
            >
              <Plus size={12} />
              <span>Add</span>
              <ChevronDown size={12} />
            </button>
            <Show when={menuOpen()}>
              <div class="mcp-menu">
                <button
                  class="mcp-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    void loadMarketplace()
                    setShowMarketplace(true)
                  }}
                >
                  Add from Marketplace
                  <ExternalLink size={12} />
                </button>
                <button
                  class="mcp-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    resetManualForm()
                    setShowManual(true)
                  }}
                >
                  Add Manually
                </button>
              </div>
            </Show>
          </div>
          <button
            onClick={() => openExternal(MCP_LINKER_RELEASES)}
            class="mcp-link-button"
            title="Install MCP Linker"
          >
            MCP Market
          </button>
        </div>
      </div>

      <Show when={error()}>
        {(err) => <div class="text-[11px] text-amber-400">{err()}</div>}
      </Show>

      <Show
        when={!isLoading() && servers().length > 0}
        fallback={<div class="text-[11px] text-zinc-500 italic">{isLoading() ? "Loading MCP servers..." : "No MCP servers configured."}</div>}
      >
        <div class="mcp-server-list">
          <For each={servers()}>
            {([name, server]) => (
              <div class="mcp-server-card">
                <div class="mcp-server-row">
                  <div class="flex flex-col">
                    <span class="text-xs font-semibold text-zinc-100">{name}</span>
                    <span class="text-[11px] text-zinc-500 truncate">
                      {server.command ? `${server.command} ${(server.args ?? []).join(" ")}` : "Custom config"}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={mcpStatus()?.[name]?.status}>
                      <span class="mcp-status-chip">
                        {mcpStatus()?.[name]?.status}
                      </span>
                    </Show>
                    <Show when={mcpStatus()?.[name]?.error}>
                      <span class="mcp-status-error" title={String(mcpStatus()?.[name]?.error)}>
                        error
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-3">
        <InstanceServiceStatus sections={["mcp"]} />
      </div>

      <Dialog open={showManual()} onOpenChange={setShowManual} modal>
        <Dialog.Portal>
          <Dialog.Overlay class="modal-overlay" />
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Content class="modal-surface w-full max-w-2xl p-5 flex flex-col gap-4">
              <div class="flex items-center justify-between">
                <div>
                  <Dialog.Title class="text-sm font-semibold text-white">Configure MCP Server</Dialog.Title>
                  <Dialog.Description class="text-xs text-zinc-500">
                    Paste the MCP server config JSON. Use marketplace via MCP Linker for curated servers.
                  </Dialog.Description>
                </div>
                <button
                  class="text-xs px-2 py-1 rounded border border-white/10 text-zinc-400 hover:text-white"
                  onClick={() => setRawMode((prev) => !prev)}
                >
                  {rawMode() ? "Server Mode" : "Raw Config (JSON)"}
                </button>
              </div>

              <Show when={!rawMode()}>
                <label class="flex flex-col gap-1 text-xs text-zinc-400">
                  Server Name
                  <input
                    value={serverName()}
                    onInput={(e) => setServerName(e.currentTarget.value)}
                    class="rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/60"
                    placeholder="example-server"
                  />
                </label>
              </Show>

              <label class="flex flex-col gap-1 text-xs text-zinc-400">
                Config JSON
                <textarea
                  value={serverJson()}
                  onInput={(e) => setServerJson(e.currentTarget.value)}
                  class="min-h-[200px] rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500/60"
                  placeholder='{"command":"npx","args":["-y","mcp-server-example"]}'
                />
              </label>

              <div class="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    resetManualForm()
                    setShowManual(false)
                  }}
                  class="px-3 py-1.5 text-xs rounded-md border border-white/10 text-zinc-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualSave}
                  disabled={saving()}
                  class="px-3 py-1.5 text-xs rounded-md bg-blue-500/20 border border-blue-500/40 text-blue-200 hover:text-white disabled:opacity-60"
                >
                  {saving() ? "Saving..." : "Confirm"}
                </button>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>

      <Dialog open={showMarketplace()} onOpenChange={setShowMarketplace} modal>
        <Dialog.Portal>
          <Dialog.Overlay class="modal-overlay" />
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Content class="modal-surface w-full max-w-3xl p-5 flex flex-col gap-4">
              <div class="flex items-center justify-between">
                <div>
                  <Dialog.Title class="text-sm font-semibold text-white">MCP Marketplace</Dialog.Title>
                  <Dialog.Description class="text-xs text-zinc-500">
                    Curated entries inspired by mcp-linker. Install writes to this workspace&apos;s .mcp.json.
                  </Dialog.Description>
                </div>
                <button
                  class="mcp-link-button"
                  onClick={() => openExternal(MCP_LINKER_MARKET)}
                >
                  Open MCP Linker
                </button>
              </div>

              <div class="mcp-market-search">
                <Search size={14} class="text-zinc-500" />
                <input
                  value={marketplaceQuery()}
                  onInput={(e) => setMarketplaceQuery(e.currentTarget.value)}
                  placeholder="Search MCP servers..."
                  class="mcp-market-input"
                />
              </div>

              <div class="mcp-market-list">
                <Show
                  when={!marketplaceLoading()}
                  fallback={<div class="text-[11px] text-zinc-500 italic">Loading marketplace sources...</div>}
                >
                  <For each={filteredMarketplace()}>
                    {(entry) => (
                      <div class="mcp-market-card">
                        <div class="mcp-market-card-info">
                          <div class="mcp-market-card-title">
                            {entry.name}
                            <Show when={entry.source}>
                              {(source) => <span class="mcp-market-source">{source()}</span>}
                            </Show>
                          </div>
                          <div class="mcp-market-card-desc">{entry.description}</div>
                          <Show when={entry.tags && entry.tags.length > 0}>
                            <div class="mcp-market-tags">
                              <For each={entry.tags}>
                                {(tag) => <span class="mcp-market-tag">{tag}</span>}
                              </For>
                            </div>
                          </Show>
                        </div>
                        <div class="mcp-market-card-actions">
                          <button
                            class="mcp-icon-button"
                            title="View config"
                            onClick={() => {
                              setShowManual(true)
                              setRawMode(false)
                              setServerName(entry.id)
                              setServerJson(JSON.stringify(entry.config, null, 2))
                              setShowMarketplace(false)
                            }}
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            class="mcp-market-install"
                            onClick={() => handleMarketplaceInstall(entry)}
                            disabled={saving()}
                          >
                            <Plus size={12} />
                            Install
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </div>
  )
}

export default McpManager
