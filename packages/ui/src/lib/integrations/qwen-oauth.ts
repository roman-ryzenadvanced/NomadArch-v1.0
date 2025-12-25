/**
 * Qwen Code OAuth Integration
 * Provides OAuth authentication and API access for Qwen Code
 */

import { nanoid } from 'nanoid'
import { createSignal, onMount } from 'solid-js'
import { getUserScopedKey } from "../user-storage"

// Configuration schema
export interface QwenConfig {
  clientId?: string
  redirectUri?: string
  scope?: string
  baseUrl?: string
  apiBaseUrl?: string
}

export interface QwenAuthToken {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
  created_at: number
  resource_url?: string
}

export interface QwenUser {
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

export interface QwenOAuthState {
  state: string
  code_verifier: string
  code_challenge: string
  redirect_uri: string
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class QwenOAuthManager {
  private config: { clientId: string; redirectUri: string; scope: string; baseUrl: string }
  private tokenStorageKey = getUserScopedKey('qwen_oauth_token')
  private userStorageKey = getUserScopedKey('qwen_user_info')

  constructor(config: QwenConfig = {}) {
    this.config = {
      clientId: config.clientId || 'qwen-code-client',
      redirectUri: config.redirectUri || `${window.location.origin}/auth/qwen/callback`,
      scope: config.scope || 'openid profile email model.completion',
      baseUrl: config.apiBaseUrl || config.baseUrl || ''
    }
  }

  /**
   * Request device authorization for Qwen OAuth
   */
  async requestDeviceAuthorization(codeChallenge: string): Promise<{
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete: string
    expires_in: number
  }> {
    const response = await fetch(`${this.config.baseUrl}/api/qwen/oauth/device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Device authorization failed: ${message}`)
    }

    return await response.json()
  }

  /**
   * Poll device token endpoint
   */
  async pollDeviceToken(deviceCode: string, codeVerifier: string): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/api/qwen/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        device_code: deviceCode,
        code_verifier: codeVerifier
      })
    })

    const rawText = await response.text()
    try {
      return JSON.parse(rawText)
    } catch {
      throw new Error(`Token poll failed: ${rawText}`)
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(): Promise<QwenAuthToken> {
    const currentToken = this.getStoredToken()
    if (!currentToken?.refresh_token) {
      throw new Error('No refresh token available')
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/qwen/oauth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: currentToken.refresh_token
        })
      })

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.statusText}`)
      }

      const tokenData = await response.json()
      const token = this.parseTokenResponse(tokenData)
      this.storeToken(token)

      return token
    } catch (error) {
      // If refresh fails, clear stored token
      this.clearToken()
      throw error
    }
  }

  /**
   * Get authenticated user info from API
   */
  async fetchUserInfo(): Promise<QwenUser> {
    const token = await this.getValidToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await fetch(`/api/qwen/user`, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`
        }
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.statusText}`)
      }
      const data = await response.json()
      return data.user || data
    } catch {
      return {
        id: 'qwen-oauth',
        username: 'Qwen OAuth',
        tier: 'Free',
        limits: {
          requests_per_day: 0,
          requests_per_minute: 0
        }
      }
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(): Promise<QwenAuthToken | null> {
    const token = this.getStoredToken()
    if (!token) {
      return null
    }

    if (this.isTokenExpired(token)) {
      try {
        return await this.refreshToken()
      } catch (error) {
        console.error('Failed to refresh token:', error)
        return null
      }
    }

    return token
  }

  /**
   * Sign out user
   */
  signOut(): void {
    this.clearToken()
    this.clearUserInfo()
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getStoredToken()
    if (!token) return false
    return !this.isTokenExpired(token)
  }

  /**
   * Get stored user info
   */
  getUserInfo(): QwenUser | null {
    try {
      const stored = localStorage.getItem(this.userStorageKey)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  }

  /**
   * Store user info
   */
  storeUserInfo(user: QwenUser): void {
    localStorage.setItem(this.userStorageKey, JSON.stringify(user))
  }

  /**
   * Clear user info
   */
  private clearUserInfo(): void {
    localStorage.removeItem(this.userStorageKey)
  }

  /**
   * Generate PKCE OAuth state
   */
  private async generateOAuthState(): Promise<QwenOAuthState> {
    const state = nanoid()
    const code_verifier = this.generateCodeVerifier()
    const code_challenge = await this.generateCodeChallenge(code_verifier)

    const oauthState: QwenOAuthState = {
      state,
      code_verifier,
      code_challenge,
      redirect_uri: this.config.redirectUri
    }

    // Store state temporarily
    sessionStorage.setItem(`qwen_oauth_${state}`, JSON.stringify(oauthState))

    return oauthState
  }

  /**
   * Get stored OAuth state
   */
  private getOAuthState(state: string): QwenOAuthState | null {
    try {
      const stored = sessionStorage.getItem(`qwen_oauth_${state}`)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  }

  /**
   * Clear OAuth state
   */
  private clearOAuthState(state: string): void {
    sessionStorage.removeItem(`qwen_oauth_${state}`)
  }

  /**
   * Generate code verifier for PKCE
   */
  generateCodeVerifier(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return toBase64Url(array)
  }

  /**
   * Generate code challenge for PKCE
   */
  async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return toBase64Url(new Uint8Array(digest))
  }

  /**
   * Parse token response
   */
  parseTokenResponse(data: any): QwenAuthToken {
    const token: QwenAuthToken = {
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      scope: data.scope,
      resource_url: data.resource_url,
      created_at: Math.floor(Date.now() / 1000)
    }

    return token
  }

  /**
   * Store token
   */
  storeToken(token: QwenAuthToken): void {
    localStorage.setItem(this.tokenStorageKey, JSON.stringify(token))
  }

  /**
   * Get stored token
   */
  private getStoredToken(): QwenAuthToken | null {
    try {
      const stored = localStorage.getItem(this.tokenStorageKey)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  }

  getTokenInfo(): QwenAuthToken | null {
    return this.getStoredToken()
  }

  private isTokenExpired(token: QwenAuthToken): boolean {
    const createdAt = token.created_at > 1e12 ? Math.floor(token.created_at / 1000) : token.created_at
    const expiresAt = (createdAt + token.expires_in) * 1000 - 300000
    return Date.now() >= expiresAt
  }

  /**
   * Clear token
   */
  private clearToken(): void {
    localStorage.removeItem(this.tokenStorageKey)
  }
}

// Solid Hook for Qwen OAuth
export function useQwenOAuth(config?: QwenConfig) {
  const authManager = () => new QwenOAuthManager(config)
  const [isAuthenticated, setIsAuthenticated] = createSignal(false)
  const [user, setUser] = createSignal<QwenUser | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [tokenInfo, setTokenInfo] = createSignal<QwenAuthToken | null>(null)

  // Check authentication status on mount
  onMount(() => {
    const manager = authManager()
    manager.getValidToken().then((token) => {
      if (!token) return
      setIsAuthenticated(true)
      setTokenInfo(manager.getTokenInfo())
      const userInfo = manager.getUserInfo()
      if (userInfo) {
        setUser(userInfo)
      }
    }).catch(() => {
      setIsAuthenticated(false)
    })
  })

  const signIn = async () => {
    setIsLoading(true)
    try {
      const manager = authManager()
      const codeVerifier = manager.generateCodeVerifier()
      const codeChallenge = await manager.generateCodeChallenge(codeVerifier)
      const deviceAuth = await manager.requestDeviceAuthorization(codeChallenge)

      const popup = window.open(
        deviceAuth.verification_uri_complete,
        'qwen-oauth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!popup) {
        window.alert(
          `Open this URL to authenticate: ${deviceAuth.verification_uri_complete}\n\nUser code: ${deviceAuth.user_code}`,
        )
      }

      const expiresAt = Date.now() + deviceAuth.expires_in * 1000
      let pollInterval = 2000

      while (Date.now() < expiresAt) {
        const tokenData = await manager.pollDeviceToken(deviceAuth.device_code, codeVerifier)

        if (tokenData?.access_token) {
          const token = manager.parseTokenResponse(tokenData)
          manager.storeToken(token)
          setTokenInfo(manager.getTokenInfo())
          const userInfo = await manager.fetchUserInfo()
          if (userInfo) {
            manager.storeUserInfo(userInfo)
            setUser(userInfo)
          } else {
            setUser(null)
          }
          setIsAuthenticated(true)
          setIsLoading(false)
          popup?.close()
          return
        }

        if (tokenData?.error === 'authorization_pending') {
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
          continue
        }

        if (tokenData?.error === 'slow_down') {
          pollInterval = Math.min(Math.ceil(pollInterval * 1.5), 10000)
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
          continue
        }

        throw new Error(tokenData?.error_description || tokenData?.error || 'OAuth failed')
      }

      throw new Error('OAuth timed out')

    } catch (error) {
      setIsLoading(false)
      throw error
    }
  }

  const signOut = () => {
    const manager = authManager()
    manager.signOut()
    setIsAuthenticated(false)
    setUser(null)
    setTokenInfo(null)
  }

  return {
    isAuthenticated: () => isAuthenticated(),
    user: () => user(),
    isLoading: () => isLoading(),
    tokenInfo: () => tokenInfo(),
    signIn,
    signOut
  }
}
