import { Component, createSignal, onMount, Show } from 'solid-js'
import toast from 'solid-toast'
import { Button } from '@suid/material'
import { Cloud, CheckCircle, XCircle, Loader } from 'lucide-solid'
import { instances } from '../../stores/instances'
import { fetchProviders } from '../../stores/session-api'

interface OllamaCloudConfig {
  enabled: boolean
  apiKey?: string
  endpoint?: string
}

interface OllamaCloudModelsResponse {
  models: Array<{
    name: string
    model?: string
    size?: string | number
    digest?: string
    modified_at?: string
    details?: any
  }>
}

const OllamaCloudSettings: Component = () => {
  const [config, setConfig] = createSignal<OllamaCloudConfig>({ enabled: false })
  const [isLoading, setIsLoading] = createSignal(false)
  const [isTesting, setIsTesting] = createSignal(false)
  const [connectionStatus, setConnectionStatus] = createSignal<'idle' | 'testing' | 'connected' | 'failed'>('idle')
  const [models, setModels] = createSignal<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = createSignal(false)
  const [hasStoredApiKey, setHasStoredApiKey] = createSignal(false)

  // Load config on mount
  onMount(async () => {
    try {
      const response = await fetch('/api/ollama/config')
      if (response.ok) {
        const data = await response.json()
        const maskedKey = typeof data.config?.apiKey === "string" && /^\*+$/.test(data.config.apiKey)
        setHasStoredApiKey(Boolean(data.config?.apiKey) && maskedKey)
        setConfig({
          ...data.config,
          apiKey: maskedKey ? "" : data.config?.apiKey,
        })
      }
    } catch (error) {
      console.error('Failed to load Ollama config:', error)
    }
  })

  const handleConfigChange = (field: keyof OllamaCloudConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }))
    setConnectionStatus('idle')
  }

  const saveConfig = async () => {
    setIsLoading(true)
    try {
      const payload: OllamaCloudConfig = { ...config() }
      if (!payload.apiKey && hasStoredApiKey()) {
        delete payload.apiKey
      }

      const response = await fetch('/api/ollama/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        toast.success('Ollama Cloud configuration saved', {
          duration: 3000,
          icon: <CheckCircle class="w-4 h-4 text-green-500" />
        })

        // Refresh providers for all instances so models appear in selector
        const instanceList = Array.from(instances().values())
        for (const instance of instanceList) {
          try {
            await fetchProviders(instance.id)
          } catch (error) {
            console.error(`Failed to refresh providers for instance ${instance.id}:`, error)
          }
        }
      } else {
        throw new Error('Failed to save config')
      }
    } catch (error) {
      toast.error('Failed to save Ollama Cloud configuration', {
        duration: 5000,
        icon: <XCircle class="w-4 h-4 text-red-500" />
      })
    } finally {
      setIsLoading(false)
    }
  }

  const testConnection = async () => {
    setIsTesting(true)
    setConnectionStatus('testing')

    try {
      const response = await fetch('/api/ollama/test', {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        setConnectionStatus(data.connected ? 'connected' : 'failed')

        if (data.connected) {
          toast.success('Successfully connected to Ollama Cloud', {
            duration: 3000,
            icon: <CheckCircle class="w-4 h-4 text-green-500" />
          })

          // Load models after successful connection
          loadModels()
        } else {
          toast.error('Failed to connect to Ollama Cloud', {
            duration: 3000,
            icon: <XCircle class="w-4 h-4 text-red-500" />
          })
        }
      } else {
        throw new Error('Connection test failed')
      }
    } catch (error) {
      setConnectionStatus('failed')
      toast.error('Connection test failed', {
        duration: 3000,
        icon: <XCircle class="w-4 h-4 text-red-500" />
      })
    } finally {
      setIsTesting(false)
    }
  }

  const loadModels = async () => {
    setIsLoadingModels(true)
    try {
      const response = await fetch('/api/ollama/models')
      if (response.ok) {
        const data = await response.json()
        // Handle different response formats
        if (data.models && Array.isArray(data.models)) {
          setModels(data.models.map((model: any) => model.name || model.model || 'unknown'))
          if (data.models.length > 0) {
            toast.success(`Loaded ${data.models.length} models`, { duration: 2000 })
          }
        } else {
          console.warn('Unexpected models response format:', data)
          setModels([])
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        toast.error(`Failed to load models: ${errorData.error || response.statusText}`, {
          duration: 5000,
          icon: <XCircle class="w-4 h-4 text-red-500" />
        })
      }
    } catch (error) {
      console.error('Failed to load models:', error)
      toast.error('Failed to load models - network error', {
        duration: 5000,
        icon: <XCircle class="w-4 h-4 text-red-500" />
      })
    } finally {
      setIsLoadingModels(false)
    }
  }

  const getStatusIcon = () => {
    switch (connectionStatus()) {
      case 'testing':
        return <Loader class="w-4 h-4 animate-spin" />
      case 'connected':
        return <CheckCircle class="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle class="w-4 h-4 text-red-500" />
      default:
        return null
    }
  }

  return (
    <div class="space-y-6 p-6">
      <div class="flex items-center gap-2 mb-4">
        <Cloud class="w-6 h-6" />
        <h2 class="text-xl font-semibold">Ollama Cloud Integration</h2>
      </div>

      <div class="space-y-4">
        {/* Enable/Disable Toggle */}
        <div class="flex items-center justify-between">
          <label class="font-medium">Enable Ollama Cloud</label>
          <input
            type="checkbox"
            checked={config().enabled}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
            class="w-4 h-4"
          />
        </div>

        {/* API Key */}
        <div>
          <label class="block font-medium mb-2">API Key</label>
          <input
            type="password"
            placeholder={hasStoredApiKey() ? "API key stored (leave empty to keep)" : "Enter your Ollama Cloud API key"}
            value={config().apiKey || ''}
            onChange={(e) => handleConfigChange('apiKey', e.target.value)}
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!config().enabled}
          />
          <p class="text-xs text-gray-500 mt-1">Get your API key from <a href="https://ollama.com/settings/keys" target="_blank" class="text-blue-500 underline">ollama.com/settings/keys</a></p>
        </div>

        {/* Endpoint */}
        <div>
          <label class="block font-medium mb-2">Endpoint</label>
          <input
            type="text"
            placeholder="https://ollama.com"
            value={config().endpoint || ''}
            onChange={(e) => handleConfigChange('endpoint', e.target.value)}
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!config().enabled}
          />
          <p class="text-xs text-gray-500 mt-1">Default: https://ollama.com (for local Ollama use: http://localhost:11434)</p>
        </div>

        {/* Test Connection */}
        <div class="flex items-center gap-2">
          <Button
            variant="outlined"
            onClick={testConnection}
            disabled={!config().enabled || isTesting()}
            class="flex items-center gap-2"
          >
            {getStatusIcon()}
            {isTesting() ? 'Testing...' : 'Test Connection'}
          </Button>

          <Show when={connectionStatus() === 'connected'}>
            <span class="text-green-600 text-sm">Connected successfully</span>
          </Show>
          <Show when={connectionStatus() === 'failed'}>
            <span class="text-red-600 text-sm">Connection failed</span>
          </Show>
        </div>

        {/* Available Models */}
        <Show when={models().length > 0}>
          <div>
            <label class="block font-medium mb-2">Available Models</label>
            <div class="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
              {models().map(model => (
                <div class="p-3 border border-gray-200 rounded-md bg-gray-50">
                  <code class="text-sm font-mono">{model}</code>
                </div>
              ))}
            </div>
          </div>
        </Show>

        {/* Save Configuration */}
        <div class="flex justify-end">
          <Button
            variant="contained"
            onClick={saveConfig}
            disabled={isLoading()}
            class="flex items-center gap-2"
          >
            {isLoading() ? <Loader class="w-4 h-4 animate-spin" /> : null}
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  )
}

export default OllamaCloudSettings
