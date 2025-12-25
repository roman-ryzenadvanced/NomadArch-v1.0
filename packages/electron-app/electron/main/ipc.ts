import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron"
import path from "path"
import type { CliProcessManager, CliStatus } from "./process-manager"
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  verifyPassword,
  setActiveUser,
  createGuestUser,
  getActiveUser,
  getUserDataRoot,
} from "./user-store"

interface DialogOpenRequest {
  mode: "directory" | "file"
  title?: string
  defaultPath?: string
  filters?: Array<{ name?: string; extensions: string[] }>
}

interface DialogOpenResult {
  canceled: boolean
  paths: string[]
}

export function setupCliIPC(mainWindow: BrowserWindow, cliManager: CliProcessManager) {
  cliManager.on("status", (status: CliStatus) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cli:status", status)
    }
  })

  cliManager.on("ready", (status: CliStatus) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cli:ready", status)
    }
  })

  cliManager.on("error", (error: Error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cli:error", { message: error.message })
    }
  })

  ipcMain.handle("cli:getStatus", async () => cliManager.getStatus())

  ipcMain.handle("cli:restart", async () => {
    const devMode = process.env.NODE_ENV === "development"
    await cliManager.stop()
    return cliManager.start({ dev: devMode })
  })

  ipcMain.handle("users:list", async () => listUsers())
  ipcMain.handle("users:active", async () => getActiveUser())
  ipcMain.handle("users:create", async (_, payload: { name: string; password: string }) => {
    const user = createUser(payload.name, payload.password)
    return user
  })
  ipcMain.handle("users:update", async (_, payload: { id: string; name?: string; password?: string }) => {
    const user = updateUser(payload.id, { name: payload.name, password: payload.password })
    return user
  })
  ipcMain.handle("users:delete", async (_, payload: { id: string }) => {
    deleteUser(payload.id)
    return { success: true }
  })
  ipcMain.handle("users:createGuest", async () => {
    const user = createGuestUser()
    return user
  })
  ipcMain.handle("users:login", async (_, payload: { id: string; password?: string }) => {
    const ok = verifyPassword(payload.id, payload.password ?? "")
    if (!ok) {
      return { success: false }
    }
    const user = setActiveUser(payload.id)
    const root = getUserDataRoot(user.id)
    cliManager.setUserEnv({
      CODENOMAD_USER_DIR: root,
      CLI_CONFIG: path.join(root, "config.json"),
    })
    await cliManager.stop()
    const devMode = process.env.NODE_ENV === "development"
    await cliManager.start({ dev: devMode })
    return { success: true, user }
  })

  ipcMain.handle("dialog:open", async (_, request: DialogOpenRequest): Promise<DialogOpenResult> => {
    const properties: OpenDialogOptions["properties"] =
      request.mode === "directory" ? ["openDirectory", "createDirectory"] : ["openFile"]

    const filters = request.filters?.map((filter) => ({
      name: filter.name ?? "Files",
      extensions: filter.extensions,
    }))

    const windowTarget = mainWindow.isDestroyed() ? undefined : mainWindow
    const dialogOptions: OpenDialogOptions = {
      title: request.title,
      defaultPath: request.defaultPath,
      properties,
      filters,
    }
    const result = windowTarget
      ? await dialog.showOpenDialog(windowTarget, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    return { canceled: result.canceled, paths: result.filePaths }
  })
}
