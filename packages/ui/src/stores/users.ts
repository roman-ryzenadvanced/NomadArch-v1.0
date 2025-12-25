import { createSignal } from "solid-js"
import { getLogger } from "../lib/logger"

export interface UserAccount {
  id: string
  name: string
  isGuest?: boolean
}

const log = getLogger("users")

const [users, setUsers] = createSignal<UserAccount[]>([])
const [activeUser, setActiveUserSignal] = createSignal<UserAccount | null>(null)
const [loadingUsers, setLoadingUsers] = createSignal(false)

function getElectronApi() {
  return typeof window !== "undefined" ? window.electronAPI : undefined
}

async function refreshUsers(): Promise<void> {
  const api = getElectronApi()
  if (!api?.listUsers) return
  setLoadingUsers(true)
  try {
    const list = await api.listUsers()
    setUsers(list ?? [])
    const active = api.getActiveUser ? await api.getActiveUser() : null
    setActiveUserSignal(active ?? null)
  } catch (error) {
    log.warn("Failed to load users", error)
  } finally {
    setLoadingUsers(false)
  }
}

async function createUser(name: string, password: string): Promise<UserAccount | null> {
  const api = getElectronApi()
  if (!api?.createUser) return null
  const user = await api.createUser({ name, password })
  await refreshUsers()
  return user ?? null
}

async function updateUser(id: string, updates: { name?: string; password?: string }): Promise<UserAccount | null> {
  const api = getElectronApi()
  if (!api?.updateUser) return null
  const user = await api.updateUser({ id, ...updates })
  await refreshUsers()
  return user ?? null
}

async function deleteUser(id: string): Promise<void> {
  const api = getElectronApi()
  if (!api?.deleteUser) return
  await api.deleteUser({ id })
  await refreshUsers()
}

async function loginUser(id: string, password?: string): Promise<boolean> {
  const api = getElectronApi()
  if (!api?.loginUser) return false
  const result = await api.loginUser({ id, password })
  if (result?.success) {
    setActiveUserSignal(result.user ?? null)
    await refreshUsers()
    return true
  }
  return false
}

async function createGuest(): Promise<UserAccount | null> {
  const api = getElectronApi()
  if (!api?.createGuest) return null
  const user = await api.createGuest()
  await refreshUsers()
  return user ?? null
}

export {
  users,
  activeUser,
  loadingUsers,
  refreshUsers,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
  createGuest,
}
