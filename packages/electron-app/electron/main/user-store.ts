import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "fs"
import os from "os"
import path from "path"
import crypto from "crypto"

interface UserRecord {
  id: string
  name: string
  salt?: string
  passwordHash?: string
  isGuest?: boolean
  createdAt: string
  updatedAt: string
}

interface UserStoreState {
  users: UserRecord[]
  activeUserId?: string
}

const CONFIG_ROOT = path.join(os.homedir(), ".config", "codenomad")
const USERS_FILE = path.join(CONFIG_ROOT, "users.json")
const USERS_ROOT = path.join(CONFIG_ROOT, "users")
const LEGACY_ROOT = CONFIG_ROOT
const LEGACY_INTEGRATIONS_ROOT = path.join(os.homedir(), ".nomadarch")

function nowIso() {
  return new Date().toISOString()
}

function sanitizeId(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64")
}

function generateSalt() {
  return crypto.randomBytes(16).toString("base64")
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readStore(): UserStoreState {
  try {
    if (!existsSync(USERS_FILE)) {
      return { users: [] }
    }
    const content = readFileSync(USERS_FILE, "utf-8")
    const parsed = JSON.parse(content) as UserStoreState
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      activeUserId: parsed.activeUserId,
    }
  } catch {
    return { users: [] }
  }
}

function writeStore(state: UserStoreState) {
  ensureDir(CONFIG_ROOT)
  ensureDir(USERS_ROOT)
  writeFileSync(USERS_FILE, JSON.stringify(state, null, 2), "utf-8")
}

function ensureUniqueId(base: string, existing: Set<string>) {
  let candidate = sanitizeId(base) || "user"
  let index = 1
  while (existing.has(candidate)) {
    candidate = `${candidate}-${index}`
    index += 1
  }
  return candidate
}

function getUserDir(userId: string) {
  return path.join(USERS_ROOT, userId)
}

function migrateLegacyData(targetDir: string) {
  const legacyConfig = path.join(LEGACY_ROOT, "config.json")
  const legacyInstances = path.join(LEGACY_ROOT, "instances")
  const legacyWorkspaces = path.join(LEGACY_ROOT, "opencode-workspaces")

  ensureDir(targetDir)

  if (existsSync(legacyConfig)) {
    cpSync(legacyConfig, path.join(targetDir, "config.json"), { force: true })
  }
  if (existsSync(legacyInstances)) {
    cpSync(legacyInstances, path.join(targetDir, "instances"), { recursive: true, force: true })
  }
  if (existsSync(legacyWorkspaces)) {
    cpSync(legacyWorkspaces, path.join(targetDir, "opencode-workspaces"), { recursive: true, force: true })
  }

  if (existsSync(LEGACY_INTEGRATIONS_ROOT)) {
    cpSync(LEGACY_INTEGRATIONS_ROOT, path.join(targetDir, "integrations"), { recursive: true, force: true })
  }
}

export function ensureDefaultUsers(): UserRecord {
  const store = readStore()
  if (store.users.length > 0) {
    const active = store.users.find((u) => u.id === store.activeUserId) ?? store.users[0]
    if (!store.activeUserId) {
      store.activeUserId = active.id
      writeStore(store)
    }
    return active
  }

  const existingIds = new Set<string>()
  const userId = ensureUniqueId("roman", existingIds)
  const salt = generateSalt()
  const passwordHash = hashPassword("q1w2e3r4", salt)
  const record: UserRecord = {
    id: userId,
    name: "roman",
    salt,
    passwordHash,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  store.users.push(record)
  store.activeUserId = record.id
  writeStore(store)

  const userDir = getUserDir(record.id)
  migrateLegacyData(userDir)

  return record
}

export function listUsers(): UserRecord[] {
  return readStore().users
}

export function getActiveUser(): UserRecord | null {
  const store = readStore()
  if (!store.activeUserId) return null
  return store.users.find((user) => user.id === store.activeUserId) ?? null
}

export function setActiveUser(userId: string) {
  const store = readStore()
  const user = store.users.find((u) => u.id === userId)
  if (!user) {
    throw new Error("User not found")
  }
  store.activeUserId = userId
  writeStore(store)
  return user
}

export function createUser(name: string, password: string) {
  const store = readStore()
  const existingIds = new Set(store.users.map((u) => u.id))
  const id = ensureUniqueId(name, existingIds)
  const salt = generateSalt()
  const passwordHash = hashPassword(password, salt)
  const record: UserRecord = {
    id,
    name,
    salt,
    passwordHash,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  store.users.push(record)
  writeStore(store)
  ensureDir(getUserDir(id))
  return record
}

export function createGuestUser() {
  const store = readStore()
  const existingIds = new Set(store.users.map((u) => u.id))
  const id = ensureUniqueId(`guest-${crypto.randomUUID().slice(0, 8)}`, existingIds)
  const record: UserRecord = {
    id,
    name: "Guest",
    isGuest: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  store.users.push(record)
  store.activeUserId = id
  writeStore(store)
  ensureDir(getUserDir(id))
  return record
}

export function updateUser(userId: string, updates: { name?: string; password?: string }) {
  const store = readStore()
  const target = store.users.find((u) => u.id === userId)
  if (!target) {
    throw new Error("User not found")
  }
  if (updates.name) {
    target.name = updates.name
  }
  if (updates.password && !target.isGuest) {
    const salt = generateSalt()
    target.salt = salt
    target.passwordHash = hashPassword(updates.password, salt)
  }
  target.updatedAt = nowIso()
  writeStore(store)
  return target
}

export function deleteUser(userId: string) {
  const store = readStore()
  const target = store.users.find((u) => u.id === userId)
  if (!target) return
  store.users = store.users.filter((u) => u.id !== userId)
  if (store.activeUserId === userId) {
    store.activeUserId = store.users[0]?.id
  }
  writeStore(store)
  const dir = getUserDir(userId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function verifyPassword(userId: string, password: string): boolean {
  const store = readStore()
  const user = store.users.find((u) => u.id === userId)
  if (!user) return false
  if (user.isGuest) return true
  if (!user.salt || !user.passwordHash) return false
  return hashPassword(password, user.salt) === user.passwordHash
}

export function getUserDataRoot(userId: string) {
  return getUserDir(userId)
}

export function clearGuestUsers() {
  const store = readStore()
  const guests = store.users.filter((u) => u.isGuest)
  if (guests.length === 0) return
  store.users = store.users.filter((u) => !u.isGuest)
  if (store.activeUserId && guests.some((u) => u.id === store.activeUserId)) {
    store.activeUserId = store.users[0]?.id
  }
  writeStore(store)
  for (const guest of guests) {
    const dir = getUserDir(guest.id)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
