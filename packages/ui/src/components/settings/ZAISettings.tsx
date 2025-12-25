import { Component, createSignal, onMount, Show } from 'solid-js'
import toast from 'solid-toast'
import { Button } from '@suid/material'
import { Cpu, CheckCircle, XCircle, Loader, Key, ExternalLink } from 'lucide-solid'

interface ZAIConfig {
    enabled: boolean
    apiKey?: string
    endpoint?: string
}

const ZAISettings: Component = () => {
    const [config, setConfig] = createSignal<ZAIConfig>({ enabled: false })
    const [isLoading, setIsLoading] = createSignal(false)
    const [isTesting, setIsTesting] = createSignal(false)
    const [connectionStatus, setConnectionStatus] = createSignal<'idle' | 'testing' | 'connected' | 'failed'>('idle')
    const [models, setModels] = createSignal<string[]>([])

    // Load config on mount
    onMount(async () => {
        try {
            const response = await fetch('/api/zai/config')
            if (response.ok) {
                const data = await response.json()
                setConfig(data.config)
            }
        } catch (error) {
            console.error('Failed to load Z.AI config:', error)
        }
    })

    const handleConfigChange = (field: keyof ZAIConfig, value: any) => {
        setConfig(prev => ({ ...prev, [field]: value }))
        setConnectionStatus('idle')
    }

    const saveConfig = async () => {
        setIsLoading(true)
        try {
            const response = await fetch('/api/zai/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config())
            })

            if (response.ok) {
                toast.success('Z.AI configuration saved', {
                    duration: 3000,
                    icon: <CheckCircle class="w-4 h-4 text-green-500" />
                })
            } else {
                throw new Error('Failed to save config')
            }
        } catch (error) {
            toast.error('Failed to save Z.AI configuration', {
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
            const response = await fetch('/api/zai/test', {
                method: 'POST'
            })

            if (response.ok) {
                const data = await response.json()
                setConnectionStatus(data.connected ? 'connected' : 'failed')

                if (data.connected) {
                    toast.success('Successfully connected to Z.AI', {
                        duration: 3000,
                        icon: <CheckCircle class="w-4 h-4 text-green-500" />
                    })

                    // Load models after successful connection
                    loadModels()
                } else {
                    toast.error('Failed to connect to Z.AI', {
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
        try {
            const response = await fetch('/api/zai/models')
            if (response.ok) {
                const data = await response.json()
                setModels(data.models.map((m: any) => m.name))
            }
        } catch (error) {
            console.error('Failed to load models:', error)
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
                <Cpu class="w-6 h-6 text-blue-500" />
                <h2 class="text-xl font-semibold">Z.AI Integration</h2>
            </div>

            <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                <h3 class="font-semibold text-blue-900 dark:text-blue-100 mb-2">GLM Coding Plan</h3>
                <p class="text-sm text-blue-800 dark:text-blue-200">
                    Z.AI provides access to GLM-4.7, GLM-4.6, GLM-4.5, and other GLM models through their PaaS/v4 API. Get your API key from the{' '}
                    <a
                        href="https://z.ai/manage-apikey/apikey-list"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="underline hover:no-underline inline-flex items-center gap-1"
                    >
                        Z.AI Platform <ExternalLink class="w-3 h-3" />
                    </a>
                </p>
            </div>

            <div class="space-y-4">
                {/* Enable/Disable Toggle */}
                <div class="flex items-center justify-between">
                    <label class="font-medium">Enable Z.AI</label>
                    <input
                        type="checkbox"
                        checked={config().enabled}
                        onChange={(e) => handleConfigChange('enabled', e.target.checked)}
                        class="w-4 h-4"
                    />
                </div>

                {/* API Key */}
                <div>
                    <label class="block font-medium mb-2">
                        <div class="flex items-center gap-2">
                            <Key class="w-4 h-4" />
                            API Key
                        </div>
                    </label>
                    <input
                        type="password"
                        placeholder="Enter your Z.AI API key"
                        value={config().apiKey || ''}
                        onChange={(e) => handleConfigChange('apiKey', e.target.value)}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        disabled={!config().enabled}
                    />
                    <p class="text-xs text-gray-500 mt-1">
                        Get your key from <a href="https://z.ai/manage-apikey/apikey-list" target="_blank" class="text-blue-500 hover:underline">z.ai/manage-apikey</a>
                    </p>
                </div>

                <div>
                    <label class="block font-medium mb-2">Endpoint</label>
                    <input
                        type="text"
                        placeholder="https://api.z.ai/api/coding/paas/v4"
                        value={config().endpoint || ''}
                        onChange={(e) => handleConfigChange('endpoint', e.target.value)}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        disabled={!config().enabled}
                    />
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
                        <div class="grid grid-cols-1 gap-2">
                            {models().map(model => (
                                <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800">
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

export default ZAISettings
