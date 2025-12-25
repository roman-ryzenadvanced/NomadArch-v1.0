import { createEffect, createSignal, onMount, onCleanup } from "solid-js"
import { addDebugLog } from "./debug-overlay"
import { renderMarkdown, onLanguagesLoaded, initMarkdown, decodeHtmlEntities } from "../lib/markdown"
import type { TextPart, RenderCache } from "../types/message"
import { getLogger } from "../lib/logger"
const log = getLogger("session")

const markdownRenderCache = new Map<string, RenderCache>()

function makeMarkdownCacheKey(partId: string, themeKey: string, highlightEnabled: boolean) {
  return `${partId}:${themeKey}:${highlightEnabled ? 1 : 0}`
}

interface MarkdownProps {
  part: TextPart
  isDark?: boolean
  size?: "base" | "sm" | "tight"
  disableHighlight?: boolean
  onRendered?: () => void
  instanceId: string
}

export function Markdown(props: MarkdownProps) {
  const [html, setHtml] = createSignal("")
  let containerRef: HTMLDivElement | undefined
  let latestRequestedText = ""

  const notifyRendered = () => {
    Promise.resolve().then(() => props.onRendered?.())
  }

  createEffect(() => {
    const part = props.part
    const rawText = typeof part.text === "string" ? part.text : ""
    const text = decodeHtmlEntities(rawText)
    const dark = Boolean(props.isDark)
    const themeKey = dark ? "dark" : "light"
    const highlightEnabled = !props.disableHighlight
    const partId = typeof part.id === "string" && part.id.length > 0 ? part.id : "__anonymous__"
    const cacheKey = makeMarkdownCacheKey(partId, themeKey, highlightEnabled)

    latestRequestedText = text

    // 1. Check Synchronous Local Cache
    const localCache = part.renderCache
    if (localCache && localCache.text === text && localCache.theme === themeKey) {
      setHtml(localCache.html)
      notifyRendered()
      return
    }

    // 2. Check Global Cache
    const globalCache = markdownRenderCache.get(cacheKey)
    if (globalCache && globalCache.text === text) {
      setHtml(globalCache.html)
      part.renderCache = globalCache
      notifyRendered()
      return
    }

    // 3. Throttle/Debounce Rendering for new content
    // We delay the expensive async render to avoid choking the main thread during rapid streaming
    const performRender = async () => {
      if (latestRequestedText !== text) return // Stale

      try {
        const rendered = await renderMarkdown(text, { suppressHighlight: !highlightEnabled })

        if (latestRequestedText === text) {
          const cacheEntry: RenderCache = { text, html: rendered, theme: themeKey }
          setHtml(rendered)
          part.renderCache = cacheEntry
          markdownRenderCache.set(cacheKey, cacheEntry)
          notifyRendered()
        }
      } catch (error) {
        log.error("Failed to render markdown:", error)
        if (latestRequestedText === text) {
          setHtml(text) // Fallback
        }
      }
    }

    // Heuristic: If text length matches cache length + small amount, it's streaming.
    // We can debounce. If it's a huge jump (initial load), render immediately.
    // For now, always debounce slightly to unblock main thread.
    // Using 200ms (was 50ms) for less frequent but smoother updates
    const timerId = setTimeout(performRender, 200)

    onCleanup(() => clearTimeout(timerId))
  })

  onMount(() => {
    const handleClick = async (e: Event) => {
      const target = e.target as HTMLElement
      const copyButton = target.closest(".code-block-copy") as HTMLButtonElement

      if (copyButton) {
        e.preventDefault()
        const code = copyButton.getAttribute("data-code")
        if (code) {
          const decodedCode = decodeURIComponent(code)
          await navigator.clipboard.writeText(decodedCode)
          const copyText = copyButton.querySelector(".copy-text")
          if (copyText) {
            copyText.textContent = "Copied!"
            setTimeout(() => {
              copyText.textContent = "Copy"
            }, 2000)
          }
        }
        return
      }

      const previewButton = target.closest(".code-block-preview") as HTMLButtonElement
      if (previewButton) {
        e.preventDefault()
        const code = previewButton.getAttribute("data-code")
        const lang = previewButton.getAttribute("data-lang")

        if (code && lang === "html") {
          const decodedCode = decodeURIComponent(code)

          // Try to find a filename in the text part
          const contentText = props.part.text || ""
          const fileMatch = contentText.match(/(\w+\.html)/)
          const fileName = fileMatch ? fileMatch[1] : null

          window.dispatchEvent(new CustomEvent("MANUAL_PREVIEW_EVENT", {
            detail: {
              code: decodedCode,
              fileName: fileName,
              instanceId: props.instanceId
            }
          }))
        }
      }
    }

    containerRef?.addEventListener("click", handleClick)

    // Register listener for language loading completion
    const cleanupLanguageListener = onLanguagesLoaded(async () => {
      if (props.disableHighlight) {
        return
      }

      const part = props.part
      const rawText = typeof part.text === "string" ? part.text : ""
      const text = decodeHtmlEntities(rawText)

      if (latestRequestedText !== text) {
        return
      }

      try {
        const rendered = await renderMarkdown(text)
        if (latestRequestedText === text) {
          setHtml(rendered)
          const themeKey = Boolean(props.isDark) ? "dark" : "light"
          part.renderCache = { text, html: rendered, theme: themeKey }
          notifyRendered()
        }
      } catch (error) {
        log.error("Failed to re-render markdown after language load:", error)
      }
    })

    onCleanup(() => {
      containerRef?.removeEventListener("click", handleClick)
      cleanupLanguageListener()
    })
  })

  const proseClass = () => "markdown-body"

  return <div ref={containerRef} class={proseClass()} innerHTML={html()} />
}
