import { tool } from "@opencode-ai/plugin/tool"

export async function HelloPlugin() {
  return {
    tool: {
      hello: tool({
        description: "Return a friendly greeting",
        args: {
          name: tool.schema.string().optional().describe("Name to greet"),
        },
        async execute(args) {
          const target = args.name?.trim() || "CodeNomad"
          return `Hello, ${target}!`
        },
      }),
    },
  }
}
