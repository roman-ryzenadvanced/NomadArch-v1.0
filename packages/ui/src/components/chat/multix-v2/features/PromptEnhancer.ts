/**
 * PromptEnhancer - Clavix-inspired prompt optimization
 * 
 * Source: https://github.com/ClavixDev/Clavix.git
 * 
 * Takes a user's raw input and refines it into a precise,
 * context-aware, actionable prompt using the session's configured model.
 */

import { getLogger } from "@/lib/logger";
import { sessions } from "@/stores/session-state";

const log = getLogger("prompt-enhancer");

// The meta-prompt based on Clavix CLEAR framework
const ENHANCEMENT_PROMPT = `You are an ELITE Software Architect and Prompt Engineer, powered by the "ThoughtBox" reasoning engine.

YOUR MISSION:
Transform the user's raw input into a "God-Tier" System Prompt—a comprehensive, execution-ready technical specification that a senior engineer could implement without further questions.

TARGET OUTPUT:
- Detailed, file-level architectural blueprint
- Explicit coding standards (TypeScript/solid-js/tailwindcss context implied)
- Comprehensive error handling and edge case strategy
- Step-by-step implementation plan

METHODOLOGY (ThoughtBox):
1. **Decode Intent**: What is the root problem? What is the *value*?
2. **Context Inference**: Assume a high-performance TypeScript/React/Electron environment. Infer necessary imports, stores, and services.
3. **Architectural Strategy**: Define the component hierarchy, state management (signals/stores), and side effects.
4. **Specification Generation**: Write the actual prompt.

OUTPUT FORMAT:
Return ONLY the enhanced prompt string, formatted as follows:

# 🎯 OBJECTIVE
[Concise, high-level goal]

# 🏗️ ARCHITECTURE & DESIGN
- **Files**: List exact file paths to touch/create.
- **Components**: Define props, state, and interfaces.
- **Data Flow**: Explain signal/store interactions.

# 🛡️ RESTRICTIONS & STANDARDS
- **Tech Stack**: TypeScript, SolidJS, TailwindCSS, Lucide Icons.
- **Rules**: NO placeholders, NO "todo", Strict Types, Accessibility-first.
- **Context**: [Infer from input, e.g., "Use ContextEngine for retrieval"]

# 📝 IMPLEMENTATION PLAN
1. [Step 1: Description]
2. [Step 2: Description]
...

# 💡 ORIGINAL REQUEST
"""
{INPUT}
"""
`;

/**
 * Get the model configured for a session
 */
function getSessionModel(instanceId: string, sessionId: string): string {
    try {
        const instanceSessions = sessions().get(instanceId);
        const session = instanceSessions?.get(sessionId);
        if (session?.model?.modelId) {
            return session.model.modelId;
        }
    } catch (e) {
        log.warn("Could not get session model", e);
    }
    return "minimax-m1"; // Fallback
}

/**
 * Enhance a user's prompt using the session's AI model
 */
export async function enhancePrompt(
    userInput: string,
    instanceId: string,
    sessionId?: string
): Promise<string> {
    if (!userInput.trim()) {
        return userInput;
    }

    // Get the model from the session
    const model = sessionId ? getSessionModel(instanceId, sessionId) : "minimax-m1";

    log.info("Enhancing prompt...", { length: userInput.length, model });

    try {
        // Call the Ollama API for enhancement using the session's model
        const response = await fetch("/api/ollama/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: "user",
                        content: ENHANCEMENT_PROMPT.replace("{INPUT}", userInput)
                    }
                ],
                stream: false
            })
        });

        if (!response.ok) {
            log.warn("Enhancement API failed, returning original", { status: response.status });
            return userInput;
        }

        const data = await response.json();
        const enhanced = data?.message?.content || data?.choices?.[0]?.message?.content;

        if (!enhanced || enhanced.trim().length === 0) {
            log.warn("Enhancement returned empty, using original");
            return userInput;
        }

        log.info("Prompt enhanced successfully", {
            originalLength: userInput.length,
            enhancedLength: enhanced.length,
            model
        });

        return enhanced.trim();
    } catch (error) {
        log.error("Prompt enhancement failed", error);
        return userInput;
    }
}

/**
 * Get a quick suggestion for improving a prompt (synchronous hint)
 */
export function getQuickTips(userInput: string): string[] {
    const tips: string[] = [];

    if (userInput.length < 20) {
        tips.push("Add more context for better results");
    }

    if (!userInput.includes("file") && !userInput.includes("function") && !userInput.includes("component")) {
        tips.push("Mention specific files or functions if applicable");
    }

    if (!userInput.match(/\b(create|fix|update|add|remove|refactor)\b/i)) {
        tips.push("Start with an action verb: create, fix, update, etc.");
    }

    return tips;
}
