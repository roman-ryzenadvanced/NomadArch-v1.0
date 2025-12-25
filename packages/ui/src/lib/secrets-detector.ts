import { getLogger } from "./logger.js"

const log = getLogger("secrets-detector")

export interface SecretMatch {
  type: string
  value: string
  start: number
  end: number
  reason: string
}

export interface RedactionResult {
  clean: string
  redactions: { path: string; reason: string }[]
}

export interface SecretPattern {
  name: string
  pattern: RegExp
  reason: string
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "api_key",
    pattern: /['"]?api[_-]?key['"]?\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
    reason: "API key detected",
  },
  {
    name: "bearer_token",
    pattern: /bearer\s+([a-zA-Z0-9_-]{30,})/gi,
    reason: "Bearer token detected",
  },
  {
    name: "jwt_token",
    pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    reason: "JWT token detected",
  },
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    reason: "AWS access key detected",
  },
  {
    name: "aws_secret_key",
    pattern: /['"]?aws[_-]?secret[_-]?access[_-]?key['"]?\s*[:=]\s*['"]?([a-zA-Z0-9/+]{40})['"]?/gi,
    reason: "AWS secret key detected",
  },
  {
    name: "private_key",
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
    reason: "Private key detected",
  },
  {
    name: "password",
    pattern: /['"]?(password|passwd|pwd)['"]?\s*[:=]\s*['"]?([^'\s"]{8,})['"]?/gi,
    reason: "Password field detected",
  },
  {
    name: "secret",
    pattern: /['"]?(secret|api[_-]?secret)['"]?\s*[:=]\s*['"]?([a-zA-Z0-9_-]{16,})['"]?/gi,
    reason: "Secret field detected",
  },
  {
    name: "token",
    pattern: /['"]?(token|access[_-]?token|auth[_-]?token)['"]?\s*[:=]\s*['"]?([a-zA-Z0-9_-]{30,})['"]?/gi,
    reason: "Auth token detected",
  },
  {
    name: "github_token",
    pattern: /gh[pous]_[a-zA-Z0-9]{36}/g,
    reason: "GitHub token detected",
  },
  {
    name: "openai_key",
    pattern: /sk-[a-zA-Z0-9]{48}/g,
    reason: "OpenAI API key detected",
  },
  {
    name: "database_url",
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
    reason: "Database connection URL detected",
  },
  {
    name: "credit_card",
    pattern: /\b(?:\d[ -]*?){13,16}\b/g,
    reason: "Potential credit card number detected",
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    reason: "Email address detected",
  },
  {
    name: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    reason: "IP address detected",
  },
]

const REPLACEMENT_PLACEHOLDER = "[REDACTED]"

function detectSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []

  for (const pattern of SECRET_PATTERNS) {
    let match
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags)

    while ((match = regex.exec(content)) !== null) {
      matches.push({
        type: pattern.name,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        reason: pattern.reason,
      })
    }
  }

  return matches.sort((a, b) => a.start - b.start)
}

function mergeOverlappingMatches(matches: SecretMatch[]): SecretMatch[] {
  if (matches.length === 0) return []

  const merged: SecretMatch[] = [matches[0]]

  for (let i = 1; i < matches.length; i++) {
    const current = matches[i]
    const last = merged[merged.length - 1]

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
      if (!last.reason.includes(current.reason)) {
        last.reason += ` | ${current.reason}`
      }
    } else {
      merged.push(current)
    }
  }

  return merged
}

export function redactSecrets(content: string, contextPath: string = "unknown"): RedactionResult {
  if (!content || typeof content !== "string") {
    return { clean: content, redactions: [] }
  }

  const rawMatches = detectSecrets(content)
  const mergedMatches = mergeOverlappingMatches(rawMatches)

  if (mergedMatches.length === 0) {
    return { clean: content, redactions: [] }
  }

  let result = ""
  let lastIndex = 0
  const redactions: { path: string; reason: string }[] = []

  for (const match of mergedMatches) {
    result += content.slice(lastIndex, match.start)
    result += REPLACEMENT_PLACEHOLDER
    lastIndex = match.end

    redactions.push({
      path: `${contextPath}[${match.start}:${match.end}]`,
      reason: match.reason,
    })
  }

  result += content.slice(lastIndex)

  log.info("Redacted secrets", { contextPath, count: redactions.length, types: mergedMatches.map((m) => m.type) })

  return { clean: result, redactions }
}

export function hasSecrets(content: string): boolean {
  if (!content || typeof content !== "string") {
    return false
  }

  return SECRET_PATTERNS.some((pattern) => pattern.pattern.test(content))
}

export function redactObject(obj: any, contextPath: string = "root"): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === "string") {
    const result = redactSecrets(obj, contextPath)
    return result.clean
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => redactObject(item, `${contextPath}[${index}]`))
  }

  if (typeof obj === "object") {
    const result: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = redactObject(obj[key], `${contextPath}.${key}`)
      }
    }
    return result
  }

  return obj
}

export function getSecretsReport(content: string): { total: number; byType: Record<string, number> } {
  const matches = detectSecrets(content)
  const byType: Record<string, number> = {}

  for (const match of matches) {
    byType[match.type] = (byType[match.type] || 0) + 1
  }

  return { total: matches.length, byType }
}
