import { FastifyInstance } from "fastify"
import { z } from "zod"
import type { SkillCatalogResponse, SkillDetail, SkillDescriptor } from "../../api-types"

const SKILLS_OWNER = "anthropics"
const SKILLS_REPO = "skills"
const SKILLS_BRANCH = "main"
const SKILLS_ROOT = "skills"
const CATALOG_TTL_MS = 30 * 60 * 1000
const DETAIL_TTL_MS = 30 * 60 * 1000

type CachedCatalog = { skills: SkillDescriptor[]; fetchedAt: number }
type CachedDetail = { detail: SkillDetail; fetchedAt: number }

let catalogCache: CachedCatalog | null = null
const detailCache = new Map<string, CachedDetail>()

interface RepoEntry {
  name: string
  path: string
  type: "file" | "dir"
}

function parseFrontmatter(markdown: string): { attributes: Record<string, string>; body: string } {
  if (!markdown.startsWith("---")) {
    return { attributes: {}, body: markdown.trim() }
  }
  const end = markdown.indexOf("\n---", 3)
  if (end === -1) {
    return { attributes: {}, body: markdown.trim() }
  }
  const frontmatter = markdown.slice(3, end).trim()
  const body = markdown.slice(end + 4).trimStart()
  const attributes: Record<string, string> = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    const value = match[2]?.trim() ?? ""
    attributes[key] = value
  }
  return { attributes, body }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": "NomadArch-Skills" },
  })
  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(message || `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "NomadArch-Skills" },
  })
  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(message || `Request failed (${response.status})`)
  }
  return await response.text()
}

async function fetchCatalog(): Promise<SkillDescriptor[]> {
  const url = `https://api.github.com/repos/${SKILLS_OWNER}/${SKILLS_REPO}/contents/${SKILLS_ROOT}?ref=${SKILLS_BRANCH}`
  const entries = await fetchJson<RepoEntry[]>(url)
  const directories = entries.filter((entry) => entry.type === "dir")
  const results: SkillDescriptor[] = []

  for (const dir of directories) {
    try {
      const skill = await fetchSkillDetail(dir.name)
      results.push({ id: skill.id, name: skill.name, description: skill.description })
    } catch {
      results.push({ id: dir.name, name: dir.name, description: "" })
    }
  }

  return results
}

async function fetchSkillDetail(id: string): Promise<SkillDetail> {
  const markdownUrl = `https://raw.githubusercontent.com/${SKILLS_OWNER}/${SKILLS_REPO}/${SKILLS_BRANCH}/${SKILLS_ROOT}/${id}/SKILL.md`
  const markdown = await fetchText(markdownUrl)
  const parsed = parseFrontmatter(markdown)
  const name = parsed.attributes.name || id
  const description = parsed.attributes.description || ""
  return {
    id,
    name,
    description,
    content: parsed.body.trim(),
  }
}

async function getCatalogCached(): Promise<SkillDescriptor[]> {
  const now = Date.now()
  if (catalogCache && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.skills
  }
  const skills = await fetchCatalog()
  catalogCache = { skills, fetchedAt: now }
  return skills
}

async function getDetailCached(id: string): Promise<SkillDetail> {
  const now = Date.now()
  const cached = detailCache.get(id)
  if (cached && now - cached.fetchedAt < DETAIL_TTL_MS) {
    return cached.detail
  }
  const detail = await fetchSkillDetail(id)
  detailCache.set(id, { detail, fetchedAt: now })
  return detail
}

export async function registerSkillsRoutes(app: FastifyInstance) {
  app.get("/api/skills/catalog", async (): Promise<SkillCatalogResponse> => {
    const skills = await getCatalogCached()
    return { skills }
  })

  app.get<{ Querystring: { id?: string } }>("/api/skills/detail", async (request, reply): Promise<SkillDetail> => {
    const query = z.object({ id: z.string().min(1) }).parse(request.query ?? {})
    try {
      return await getDetailCached(query.id)
    } catch (error) {
      request.log.error({ err: error, skillId: query.id }, "Failed to fetch skill detail")
      reply.code(502)
      return {
        id: query.id,
        name: query.id,
        description: "",
        content: "Unable to load skill content.",
      }
    }
  })
}
