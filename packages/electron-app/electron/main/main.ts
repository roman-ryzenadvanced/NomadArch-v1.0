import { app, BrowserView, BrowserWindow, nativeImage, session, shell } from "electron"
import { existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { createApplicationMenu } from "./menu"
import { setupCliIPC } from "./ipc"
import { CliProcessManager } from "./process-manager"
import { ensureDefaultUsers, getActiveUser, getUserDataRoot, clearGuestUsers } from "./user-store"

const mainFilename = fileURLToPath(import.meta.url)
const mainDirname = dirname(mainFilename)

const isMac = process.platform === "darwin"

const cliManager = new CliProcessManager()
let mainWindow: BrowserWindow | null = null
let currentCliUrl: string | null = null
let pendingCliUrl: string | null = null
let showingLoadingScreen = false
let preloadingView: BrowserView | null = null

// Retry logic constants
const MAX_RETRY_ATTEMPTS = 5
const LOAD_TIMEOUT_MS = 30000
let retryAttempts = 0

if (isMac) {
  app.commandLine.appendSwitch("disable-spell-checking")
}

// Windows: Use Edge WebView2 rendering for better performance
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-features", "WebViewTagWebComponent,WebView2")
  app.commandLine.appendSwitch("disable-gpu-sandbox")
  app.commandLine.appendSwitch("enable-gpu-rasterization")
  app.commandLine.appendSwitch("enable-zero-copy")
  app.commandLine.appendSwitch("disable-background-timer-throttling")
  app.commandLine.appendSwitch("disable-renderer-backgrounding")
}

function getIconPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icon.png")
  }

  return join(mainDirname, "../resources/icon.png")
}

type LoadingTarget =
  | { type: "url"; source: string }
  | { type: "file"; source: string }

function resolveDevLoadingUrl(): string | null {
  if (app.isPackaged) {
    return null
  }
  const devBase = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL
  if (!devBase) {
    return null
  }

  try {
    const normalized = devBase.endsWith("/") ? devBase : `${devBase}/`
    return new URL("loading.html", normalized).toString()
  } catch (error) {
    console.warn("[cli] failed to construct dev loading URL", devBase, error)
    return null
  }
}

function resolveLoadingTarget(): LoadingTarget {
  const devUrl = resolveDevLoadingUrl()
  if (devUrl) {
    return { type: "url", source: devUrl }
  }
  const filePath = resolveLoadingFilePath()
  return { type: "file", source: filePath }
}

function resolveLoadingFilePath() {
  const candidates = [
    join(app.getAppPath(), "dist/renderer/loading.html"),
    join(process.resourcesPath, "dist/renderer/loading.html"),
    join(mainDirname, "../dist/renderer/loading.html"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return join(app.getAppPath(), "dist/renderer/loading.html")
}

function loadLoadingScreen(window: BrowserWindow) {
  const target = resolveLoadingTarget()
  const loader =
    target.type === "url"
      ? window.loadURL(target.source)
      : window.loadFile(target.source)

  loader.catch((error) => {
    console.error("[cli] failed to load loading screen:", error)
  })
}

// Calculate exponential backoff delay
function getRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 16000) // 1s, 2s, 4s, 8s, 16s max
}

// Show user-friendly error screen
function showErrorScreen(window: BrowserWindow, errorMessage: string) {
  const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 40px;
          font-family: system-ui, -apple-system, sans-serif;
          background: #1a1a1a;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          box-sizing: border-box;
        }
        .error-icon { font-size: 48px; margin-bottom: 20px; }
        h1 { margin: 0 0 16px; font-size: 24px; font-weight: 600; }
        p { margin: 0 0 24px; color: #888; font-size: 14px; text-align: center; max-width: 400px; }
        .error-code { font-family: monospace; background: #2a2a2a; padding: 8px 16px; border-radius: 6px; font-size: 12px; color: #f87171; margin-bottom: 24px; }
        button {
          background: #6366f1;
          color: white;
          border: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        button:hover { background: #818cf8; transform: scale(1.02); }
      </style>
    </head>
    <body>
      <div class="error-icon">⚠️</div>
      <h1>Connection Failed</h1>
      <p>NomadArch couldn't connect to the development server after multiple attempts. Please ensure the server is running.</p>
      <div class="error-code">${errorMessage}</div>
      <button onclick="location.reload()">Retry</button>
    </body>
    </html>
  `
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`)
}

function getAllowedRendererOrigins(): string[] {
  const origins = new Set<string>()
  const rendererCandidates = [currentCliUrl, process.env.VITE_DEV_SERVER_URL, process.env.ELECTRON_RENDERER_URL]
  for (const candidate of rendererCandidates) {
    if (!candidate) {
      continue
    }
    try {
      origins.add(new URL(candidate).origin)
    } catch (error) {
      console.warn("[cli] failed to parse origin for", candidate, error)
    }
  }
  return Array.from(origins)
}

function shouldOpenExternally(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true
    }
    const allowedOrigins = getAllowedRendererOrigins()
    return !allowedOrigins.includes(parsed.origin)
  } catch {
    return false
  }
}

function setupNavigationGuards(window: BrowserWindow) {
  const handleExternal = (url: string) => {
    shell.openExternal(url).catch((error) => console.error("[cli] failed to open external URL", url, error))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      handleExternal(url)
      return { action: "deny" }
    }
    return { action: "allow" }
  })

  window.webContents.on("will-navigate", (event, url) => {
    if (shouldOpenExternally(url)) {
      event.preventDefault()
      handleExternal(url)
    }
  })
}

let cachedPreloadPath: string | null = null
function getPreloadPath() {
  if (cachedPreloadPath && existsSync(cachedPreloadPath)) {
    return cachedPreloadPath
  }

  const candidates = [
    join(process.resourcesPath, "preload/index.js"),
    join(mainDirname, "../preload/index.js"),
    join(mainDirname, "../preload/index.cjs"),
    join(mainDirname, "../../preload/index.cjs"),
    join(mainDirname, "../../electron/preload/index.cjs"),
    join(app.getAppPath(), "preload/index.cjs"),
    join(app.getAppPath(), "electron/preload/index.cjs"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedPreloadPath = candidate
      return candidate
    }
  }

  return join(mainDirname, "../preload/index.js")
}

function applyUserEnvToCli() {
  const active = getActiveUser()
  if (!active) {
    const fallback = ensureDefaultUsers()
    const fallbackRoot = getUserDataRoot(fallback.id)
    cliManager.setUserEnv({
      CODENOMAD_USER_DIR: fallbackRoot,
      CLI_CONFIG: join(fallbackRoot, "config.json"),
    })
    return
  }
  const root = getUserDataRoot(active.id)
  cliManager.setUserEnv({
    CODENOMAD_USER_DIR: root,
    CLI_CONFIG: join(root, "config.json"),
  })
}

function destroyPreloadingView(target?: BrowserView | null) {
  const view = target ?? preloadingView
  if (!view) {
    return
  }

  try {
    const contents = view.webContents as any
    contents?.destroy?.()
  } catch (error) {
    console.warn("[cli] failed to destroy preloading view", error)
  }

  if (!target || view === preloadingView) {
    preloadingView = null
  }
}

function createWindow() {
  const prefersDark = true
  const backgroundColor = prefersDark ? "#1a1a1a" : "#ffffff"
  const iconPath = getIconPath()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor,
    icon: iconPath,
    title: "NomadArch 1.0",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: !isMac,
    },
  })

  setupNavigationGuards(mainWindow)

  if (isMac) {
    mainWindow.webContents.session.setSpellCheckerEnabled(false)
  }

  showingLoadingScreen = true
  currentCliUrl = null
  loadLoadingScreen(mainWindow)

  if (process.env.NODE_ENV === "development" && process.env.NOMADARCH_OPEN_DEVTOOLS === "true") {
    mainWindow.webContents.openDevTools({ mode: "detach" })
  }

  createApplicationMenu(mainWindow)
  setupCliIPC(mainWindow, cliManager)

  mainWindow.on("closed", () => {
    destroyPreloadingView()
    mainWindow = null
    currentCliUrl = null
    pendingCliUrl = null
    showingLoadingScreen = false
  })

  if (pendingCliUrl) {
    const url = pendingCliUrl
    pendingCliUrl = null
    startCliPreload(url)
  }
}

function showLoadingScreen(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (showingLoadingScreen && !force) {
    return
  }

  destroyPreloadingView()
  showingLoadingScreen = true
  currentCliUrl = null
  pendingCliUrl = null
  loadLoadingScreen(mainWindow)
}

function startCliPreload(url: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingCliUrl = url
    return
  }

  if (currentCliUrl === url && !showingLoadingScreen) {
    return
  }

  pendingCliUrl = url
  destroyPreloadingView()

  if (!showingLoadingScreen) {
    showLoadingScreen(true)
  }

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: !isMac,
    },
  })

  preloadingView = view

  view.webContents.once("did-finish-load", () => {
    if (preloadingView !== view) {
      destroyPreloadingView(view)
      return
    }
    finalizeCliSwap(url)
  })

  view.webContents.loadURL(url).catch((error) => {
    console.error("[cli] failed to preload CLI view:", error)
    if (preloadingView === view) {
      destroyPreloadingView(view)
    }
  })
}

function finalizeCliSwap(url: string) {
  destroyPreloadingView()

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingCliUrl = url
    return
  }

  showingLoadingScreen = false
  currentCliUrl = url
  pendingCliUrl = null

  // Reset retry counter on new URL
  retryAttempts = 0

  const loadWithRetry = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    // Set timeout for load
    const timeoutId = setTimeout(() => {
      console.warn(`[cli] Load timeout after ${LOAD_TIMEOUT_MS}ms`)
      handleLoadError(new Error(`Load timeout after ${LOAD_TIMEOUT_MS}ms`))
    }, LOAD_TIMEOUT_MS)

    mainWindow.loadURL(url)
      .then(() => {
        clearTimeout(timeoutId)
        retryAttempts = 0 // Reset on success
        console.info("[cli] Successfully loaded CLI view")
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        handleLoadError(error)
      })
  }

  const handleLoadError = (error: Error) => {
    const errorCode = (error as any).errno
    console.error(`[cli] failed to load CLI view (attempt ${retryAttempts + 1}/${MAX_RETRY_ATTEMPTS}):`, error.message)

    // Retry on network errors (errno -3)
    if (errorCode === -3 && retryAttempts < MAX_RETRY_ATTEMPTS) {
      retryAttempts++
      const delay = getRetryDelay(retryAttempts)
      console.info(`[cli] Retrying in ${delay}ms (attempt ${retryAttempts}/${MAX_RETRY_ATTEMPTS})`)

      if (mainWindow && !mainWindow.isDestroyed()) {
        loadLoadingScreen(mainWindow)
      }

      setTimeout(loadWithRetry, delay)
    } else if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
      console.error("[cli] Max retry attempts reached, showing error screen")
      if (mainWindow && !mainWindow.isDestroyed()) {
        showErrorScreen(mainWindow, `Failed after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`)
      }
    }
  }

  loadWithRetry()
}


async function startCli() {
  try {
    const devMode = process.env.NODE_ENV === "development"
    console.info("[cli] start requested (dev mode:", devMode, ")")
    await cliManager.start({ dev: devMode })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[cli] start failed:", message)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cli:error", { message })
    }
  }
}

cliManager.on("ready", (status) => {
  if (!status.url) {
    return
  }
  startCliPreload(status.url)
})

cliManager.on("status", (status) => {
  if (status.state !== "ready") {
    showLoadingScreen()
  }
})

if (isMac) {
  app.on("web-contents-created", (_, contents) => {
    contents.session.setSpellCheckerEnabled(false)
  })
}

app.whenReady().then(() => {
  ensureDefaultUsers()
  applyUserEnvToCli()
  startCli()

  if (isMac) {
    session.defaultSession.setSpellCheckerEnabled(false)
    app.on("browser-window-created", (_, window) => {
      window.webContents.session.setSpellCheckerEnabled(false)
    })

    if (app.dock) {
      const dockIcon = nativeImage.createFromPath(getIconPath())
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    }
  }

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("before-quit", async (event) => {
  event.preventDefault()
  await cliManager.stop().catch(() => { })
  clearGuestUsers()
  app.exit(0)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
