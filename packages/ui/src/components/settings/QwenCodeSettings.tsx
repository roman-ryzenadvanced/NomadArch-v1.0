import { Component, createSignal, onMount, Show } from 'solid-js'
import toast from 'solid-toast'
import { Button } from '@suid/material'
import { User, CheckCircle, XCircle, Loader, LogOut, ExternalLink } from 'lucide-solid'
import { useQwenOAuth } from '../../lib/integrations/qwen-oauth'
import { instances } from '../../stores/instances'
import { fetchProviders } from '../../stores/session-api'

interface QwenUser {
  id: string
  username: string
  email?: string
  avatar?: string
  tier: string
  limits: {
    requests_per_day: number
    requests_per_minute: number
  }
}

const QwenCodeSettings: Component = () => {
  const { isAuthenticated, user, isLoading, signIn, signOut, tokenInfo } = useQwenOAuth()
  const [isSigningOut, setIsSigningOut] = createSignal(false)

  const handleSignIn = async () => {
    try {
      await signIn()
      toast.success('Successfully authenticated with Qwen Code', {
        duration: 3000,
        icon: <CheckCircle class="w-4 h-4 text-green-500" />
      })
      for (const instance of instances().values()) {
        try {
          await fetchProviders(instance.id)
        } catch (error) {
          console.error(`Failed to refresh providers for instance ${instance.id}:`, error)
        }
      }
    } catch (error) {
      toast.error('Failed to authenticate with Qwen Code', {
        duration: 5000,
        icon: <XCircle class="w-4 h-4 text-red-500" />
      })
      console.error('Qwen OAuth error:', error)
    }
  }

  const handleSignOut = () => {
    setIsSigningOut(true)
    try {
      signOut()
      toast.success('Successfully signed out from Qwen Code', {
        duration: 3000,
        icon: <CheckCircle class="w-4 h-4 text-green-500" />
      })
    } catch (error) {
      toast.error('Failed to sign out from Qwen Code', {
        duration: 5000,
        icon: <XCircle class="w-4 h-4 text-red-500" />
      })
      console.error('Qwen signout error:', error)
    } finally {
      setIsSigningOut(false)
    }
  }

  const formatRemainingRequests = (user: QwenUser) => {
    return `${user.limits.requests_per_day} requests/day, ${user.limits.requests_per_minute}/min`
  }

  const formatTokenExpiry = () => {
    const token = tokenInfo()
    if (!token) return "Token not available"
    const createdAt = token.created_at > 1e12 ? Math.floor(token.created_at / 1000) : token.created_at
    const expiresAt = (createdAt + token.expires_in) * 1000
    const remainingMs = Math.max(0, expiresAt - Date.now())
    const remainingMin = Math.floor(remainingMs / 60000)
    return `${remainingMin} min remaining`
  }

  const tokenStatus = () => {
    const token = tokenInfo()
    if (!token) return "Unknown"
    const createdAt = token.created_at > 1e12 ? Math.floor(token.created_at / 1000) : token.created_at
    const expiresAt = (createdAt + token.expires_in) * 1000
    return Date.now() < expiresAt ? "Active" : "Expired"
  }

  const tokenId = () => {
    const token = tokenInfo()
    if (!token?.access_token) return "Unavailable"
    const value = token.access_token
    if (value.length <= 12) return value
    return `${value.slice(0, 6)}...${value.slice(-4)}`
  }

  return (
    <div class="space-y-6 p-6">
      <div class="flex items-center gap-2 mb-4">
        <User class="w-6 h-6" />
        <h2 class="text-xl font-semibold">Qwen Code Integration</h2>
      </div>

      {/* Authentication Status */}
      <div class="space-y-4">
        <Show
          when={isAuthenticated()}
          fallback={
            /* Not Authenticated State */
            <div class="text-center py-8">
              <div class="mb-4">
                <User class="w-12 h-12 mx-auto text-gray-400" />
                <p class="mt-2 text-gray-600 dark:text-gray-400">
                  Connect your Qwen Code account to access AI-powered coding assistance
                </p>
              </div>
              
              <Button
                variant="contained"
                onClick={handleSignIn}
                disabled={isLoading()}
                class="flex items-center gap-2 mx-auto"
              >
                {isLoading() ? <Loader class="w-4 h-4 animate-spin" /> : null}
                Connect Qwen Code Account
              </Button>
              
              <div class="mt-4 text-sm text-gray-500">
                <p>Get 2,000 free requests per day with Qwen OAuth</p>
                <a 
                  href="https://qwen.ai" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="text-blue-600 hover:underline inline-flex items-center gap-1 mt-2"
                >
                  <ExternalLink class="w-3 h-3" />
                  Learn more about Qwen Code
                </a>
              </div>
            </div>
          }
        >
          {/* Authenticated State */}
          <div class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center">
                  <User class="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 class="font-semibold text-green-900 dark:text-green-100">
                    {user()?.username || 'Qwen User'}
                  </h3>
                  <p class="text-sm text-green-700 dark:text-green-300">
                    {user()?.email}
                  </p>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs px-2 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-full">
                      {user()?.tier || 'Free'} Tier
                    </span>
                    <Show when={user()}>
                      <span class="text-xs text-green-600 dark:text-green-400">
                        {formatRemainingRequests(user()!)}
                      </span>
                    </Show>
                    <span class="text-xs text-green-600 dark:text-green-400">
                      {formatTokenExpiry()}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 mt-2 text-xs text-green-700 dark:text-green-300">
                    <span class="font-semibold">Token ID:</span>
                    <span class="font-mono">{tokenId()}</span>
                    <span class="px-2 py-0.5 rounded-full bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">
                      {tokenStatus()}
                    </span>
                  </div>
                </div>
              </div>
              
              <Button
                variant="outlined"
                onClick={handleSignOut}
                disabled={isSigningOut()}
                size="small"
                class="flex items-center gap-1"
              >
                <LogOut class="w-4 h-4" />
                {isSigningOut() ? 'Signing out...' : 'Sign Out'}
              </Button>
            </div>
          </div>
        </Show>

        {/* Feature Information */}
        <div class="border-t pt-4">
          <h3 class="font-semibold mb-3">Available Features</h3>
          <div class="grid grid-cols-1 gap-3">
            <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md">
              <h4 class="font-medium text-sm">Code Understanding & Editing</h4>
              <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Query and edit large codebases beyond traditional context window limits
              </p>
            </div>
            
            <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md">
              <h4 class="font-medium text-sm">Workflow Automation</h4>
              <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Automate operational tasks like handling pull requests and complex rebases
              </p>
            </div>
            
            <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md">
              <h4 class="font-medium text-sm">Vision Model Support</h4>
              <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Automatically detect images and switch to vision-capable models for multimodal analysis
              </p>
            </div>
          </div>
        </div>

        {/* Usage Tips */}
        <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 class="font-semibold text-blue-900 dark:text-blue-100 mb-2">Usage Tips</h3>
          <ul class="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <li>• Use <code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">/compress</code> to compress conversation history</li>
            <li>• Use <code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">/stats</code> to check token usage</li>
            <li>• Vision models automatically switch when images are detected</li>
            <li>• Configure behavior in <code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">~/.qwen/settings.json</code></li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default QwenCodeSettings
