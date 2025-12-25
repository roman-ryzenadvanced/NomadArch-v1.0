const { contextBridge, ipcRenderer } = require("electron")

const electronAPI = {
  onCliStatus: (callback) => {
    ipcRenderer.on("cli:status", (_, data) => callback(data))
    return () => ipcRenderer.removeAllListeners("cli:status")
  },
  onCliError: (callback) => {
    ipcRenderer.on("cli:error", (_, data) => callback(data))
    return () => ipcRenderer.removeAllListeners("cli:error")
  },
  getCliStatus: () => ipcRenderer.invoke("cli:getStatus"),
  restartCli: () => ipcRenderer.invoke("cli:restart"),
  openDialog: (options) => ipcRenderer.invoke("dialog:open", options),
  listUsers: () => ipcRenderer.invoke("users:list"),
  getActiveUser: () => ipcRenderer.invoke("users:active"),
  createUser: (payload) => ipcRenderer.invoke("users:create", payload),
  updateUser: (payload) => ipcRenderer.invoke("users:update", payload),
  deleteUser: (payload) => ipcRenderer.invoke("users:delete", payload),
  createGuest: () => ipcRenderer.invoke("users:createGuest"),
  loginUser: (payload) => ipcRenderer.invoke("users:login", payload),
}

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
