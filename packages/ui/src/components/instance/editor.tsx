import { Component, For, Show } from "solid-js"
import { FileNode } from "./sidebar"

interface EditorProps {
  file: FileNode | null
}

export const Editor: Component<EditorProps> = (props) => {
  return (
    <Show
      when={props.file}
      fallback={
        <div class="flex-1 flex items-center justify-center text-zinc-500 bg-[#0d0d0d]">
          <div class="text-center">
            <div class="mb-4 opacity-20 flex justify-center">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <p>Select a file to start editing</p>
            <p class="text-sm mt-2 opacity-60">Press Ctrl+P to search</p>
          </div>
        </div>
      }
    >
      <div class="flex-1 overflow-hidden flex flex-col bg-[#0d0d0d]">
        <div class="h-10 glass border-b border-white/5 flex items-center px-4 space-x-2 shrink-0">
          <span class="text-xs text-zinc-400 font-medium">{props.file?.name}</span>
          <span class="text-[10px] text-zinc-600 uppercase">{props.file?.language || "text"}</span>
        </div>
        <div class="flex-1 p-6 overflow-auto mono text-sm leading-relaxed">
          <pre class="text-zinc-300">
            <Show
              when={props.file?.content}
              fallback={<span class="italic text-zinc-600">// Empty file</span>}
            >
              <For each={props.file?.content?.split("\n")}>
                {(line, i) => (
                  <div class="flex group">
                    <span class="w-12 text-zinc-600 select-none text-right pr-4">{i() + 1}</span>
                    <span class="whitespace-pre">{line}</span>
                  </div>
                )}
              </For>
            </Show>
          </pre>
        </div>
      </div>
    </Show>
  )
}
