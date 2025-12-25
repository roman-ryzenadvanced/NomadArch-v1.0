import { Component, createEffect, createSignal } from 'solid-js'
import { useNavigate } from '@solidjs/router'

interface CallbackData {
  type: 'QWEN_OAUTH_SUCCESS' | 'QWEN_OAUTH_ERROR'
  code?: string
  state?: string
  error?: string
}

const QwenOAuthCallback: Component = () => {
  const navigate = useNavigate()
  const [status, setStatus] = createSignal<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = createSignal('')

  createEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const error = urlParams.get('error')

    if (error) {
      setStatus('error')
      setMessage(`Authentication failed: ${error}`)
      sendErrorToOpener(error, state)
      return
    }

    if (code && state) {
      setStatus('success')
      setMessage('Authentication successful! You can close this window.')
      sendSuccessToOpener(code, state)
    } else {
      setStatus('error')
      setMessage('Invalid callback parameters')
    }
  })

  const sendSuccessToOpener = (code: string, state: string) => {
    if (window.opener) {
      const data: CallbackData = {
        type: 'QWEN_OAUTH_SUCCESS',
        code,
        state
      }
      window.opener.postMessage(data, window.location.origin)
    }
  }

  const sendErrorToOpener = (error: string, state: string | null) => {
    if (window.opener) {
      const data: CallbackData = {
        type: 'QWEN_OAUTH_ERROR',
        error,
        state: state || undefined
      }
      window.opener.postMessage(data, window.location.origin)
    }
  }

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div class="max-w-md w-full mx-auto p-6">
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <div class="text-center">
            <div class="mb-4">
              {status() === 'loading' && (
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              )}
              {status() === 'success' && (
                <div class="text-green-600">
                  <svg class="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 0116 0zm-1 11a1 1 0 00-2 0v-2a1 1 0 112 0v2a1 1 0 012 0zm9.077-7.908a.75.75 0 00-1.079-1.028l-7.142 7.142a.75.75 0 001.079 1.028l7.142-7.142a.75.75 0 00-1.079-1.028zM3.75 8a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0V8zM14 9.5a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5z" clip-rule="evenodd" />
                  </svg>
                  <h2 class="text-xl font-semibold text-gray-900 dark:text-white">Authentication Successful!</h2>
                </div>
              )}
              {status() === 'error' && (
                <div class="text-red-600">
                  <svg class="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 0116 0zm3.707-9.293a1 1 0 00-1.414-1.414l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 00-1.414-1.414z" clip-rule="evenodd" />
                  </svg>
                  <h2 class="text-xl font-semibold text-gray-900 dark:text-white">Authentication Failed</h2>
                </div>
              )}
            </div>
            <p class="text-gray-600 dark:text-gray-400 mb-4">{message()}</p>
            <div class="text-sm text-gray-500">
              <p>You can safely close this window.</p>
              <button
                onclick={() => window.close()}
                class="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default QwenOAuthCallback