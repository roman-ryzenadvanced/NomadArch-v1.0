import { activeUser } from "../stores/users"

export function getUserScopedKey(baseKey: string): string {
  const userId = activeUser()?.id
  if (!userId) return baseKey
  return `${baseKey}:${userId}`
}
