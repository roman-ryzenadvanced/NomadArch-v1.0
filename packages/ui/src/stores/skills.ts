import { createSignal } from "solid-js"
import type { SkillCatalogResponse, SkillDescriptor, SkillDetail } from "../../../server/src/api-types"
import { serverApi } from "../lib/api-client"
import { getLogger } from "../lib/logger"

const log = getLogger("skills")

const [catalog, setCatalog] = createSignal<SkillDescriptor[]>([])
const [catalogLoading, setCatalogLoading] = createSignal(false)
const [catalogError, setCatalogError] = createSignal<string | null>(null)

const detailCache = new Map<string, SkillDetail>()
const detailPromises = new Map<string, Promise<SkillDetail>>()

async function loadCatalog(): Promise<SkillDescriptor[]> {
  if (catalog().length > 0) return catalog()
  if (catalogLoading()) return catalog()
  setCatalogLoading(true)
  setCatalogError(null)

  try {
    const response: SkillCatalogResponse = await serverApi.fetchSkillsCatalog()
    const skills = Array.isArray(response.skills) ? response.skills : []
    setCatalog(skills)
    return skills
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load skills"
    setCatalogError(message)
    log.warn("Failed to load skills catalog", error)
    return []
  } finally {
    setCatalogLoading(false)
  }
}

async function loadSkillDetail(id: string): Promise<SkillDetail | null> {
  if (!id) return null
  if (detailCache.has(id)) return detailCache.get(id) || null
  const pending = detailPromises.get(id)
  if (pending) return pending

  const promise = serverApi
    .fetchSkillDetail(id)
    .then((detail) => {
      detailCache.set(id, detail)
      return detail
    })
    .catch((error) => {
      log.warn("Failed to load skill detail", { id, error })
      return null
    })
    .finally(() => {
      detailPromises.delete(id)
    })

  detailPromises.set(id, promise as Promise<SkillDetail>)
  return promise
}

async function loadSkillDetails(ids: string[]): Promise<SkillDetail[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return []

  const results = await Promise.all(uniqueIds.map((id) => loadSkillDetail(id)))
  return results.filter((detail): detail is SkillDetail => Boolean(detail))
}

export {
  catalog,
  catalogLoading,
  catalogError,
  loadCatalog,
  loadSkillDetail,
  loadSkillDetails,
}
