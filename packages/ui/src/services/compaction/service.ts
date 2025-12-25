/**
 * Compaction Service
 * 
 * Source: https://github.com/sst/opencode.git
 * Source: https://github.com/MiniMax-AI/Mini-Agent.git
 * 
 * Implements intelligent context management:
 * - Detect token overflow
 * - Prune old tool outputs (keep last 40k tokens protected)
 * - Generate summaries for compacted content
 */

import { getLogger } from "@/lib/logger";

const log = getLogger("compaction-service");

// Configuration from OpenCode
export const PRUNE_MINIMUM = 20_000;  // Minimum tokens before pruning
export const PRUNE_PROTECT = 40_000;  // Protect last N tokens
export const PRUNE_PROTECTED_TOOLS = ["skill", "execute"];  // Never prune these

export interface CompactionConfig {
    contextLimit: number;
    outputMax: number;
}

export interface TokenInfo {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}

export interface PruneResult {
    pruned: number;
    total: number;
    partsCount: number;
}

/**
 * Check if context is overflowing and compaction is needed
 */
export function isOverflow(tokens: TokenInfo, model: CompactionConfig): boolean {
    const context = model.contextLimit;
    if (context === 0) return false;

    const count = tokens.input + (tokens.cacheRead || 0) + tokens.output;
    const output = Math.min(model.outputMax, 32000) || 32000;
    const usable = context - output;

    return count > usable;
}

/**
 * Calculate how many tokens to prune from old tool outputs
 */
export function calculatePruneTarget(
    toolOutputTokens: number[],
    protectThreshold: number = PRUNE_PROTECT
): { toPrune: number[]; prunedTotal: number } {
    let total = 0;
    let pruned = 0;
    const toPrune: number[] = [];

    // Go through tool outputs from newest to oldest
    for (let i = toolOutputTokens.length - 1; i >= 0; i--) {
        const estimate = toolOutputTokens[i];
        total += estimate;

        // Once we've protected enough, mark the rest for pruning
        if (total > protectThreshold) {
            pruned += estimate;
            toPrune.push(i);
        }
    }

    return { toPrune, prunedTotal: pruned };
}

/**
 * Estimate token count from text (rough approximation)
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
}

/**
 * Generate the compaction summary prompt
 */
export function getCompactionPrompt(): string {
    return `Provide a detailed summary for continuing this conversation. Focus on:
1. What we accomplished so far
2. Which files we're working on
3. Current state and any pending tasks
4. Important decisions made
5. What we're doing next

Be concise but comprehensive. The new session will not have access to the full conversation history.`;
}

/**
 * Check if a tool should be protected from pruning
 */
export function isProtectedTool(toolName: string): boolean {
    return PRUNE_PROTECTED_TOOLS.some(t => toolName.toLowerCase().includes(t));
}

/**
 * Calculate context usage percentage
 */
export function getContextUsagePercent(tokens: TokenInfo, contextLimit: number): number {
    if (contextLimit === 0) return 0;
    const used = tokens.input + (tokens.cacheRead || 0) + tokens.output;
    return Math.round((used / contextLimit) * 100);
}

/**
 * Get compaction recommendation
 */
export function getCompactionRecommendation(
    tokens: TokenInfo,
    model: CompactionConfig
): { shouldCompact: boolean; reason: string; urgency: "low" | "medium" | "high" } {
    const usagePercent = getContextUsagePercent(tokens, model.contextLimit);

    if (usagePercent >= 90) {
        return {
            shouldCompact: true,
            reason: `Context ${usagePercent}% full - compaction required`,
            urgency: "high"
        };
    }

    if (usagePercent >= 75) {
        return {
            shouldCompact: true,
            reason: `Context ${usagePercent}% full - compaction recommended`,
            urgency: "medium"
        };
    }

    if (usagePercent >= 50) {
        return {
            shouldCompact: false,
            reason: `Context ${usagePercent}% full`,
            urgency: "low"
        };
    }

    return {
        shouldCompact: false,
        reason: "",
        urgency: "low"
    };
}

/**
 * Compact messages by summarizing old ones
 */
export async function compactMessages(
    messages: { role: string; content: string }[],
    instanceId: string
): Promise<{ summary: string; removedCount: number }> {
    if (messages.length < 10) {
        return { summary: "", removedCount: 0 };
    }

    // Take the first 50% of messages for summarization
    const cutoff = Math.floor(messages.length / 2);
    const toSummarize = messages.slice(0, cutoff);

    log.info("Compacting messages", { total: messages.length, summarizing: cutoff });

    try {
        const response = await fetch("/api/ollama/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "minimax-m1",
                messages: [
                    ...toSummarize,
                    { role: "user", content: getCompactionPrompt() }
                ],
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Compaction API failed: ${response.status}`);
        }

        const data = await response.json();
        const summary = data?.message?.content || "";

        return { summary, removedCount: cutoff };
    } catch (error) {
        log.error("Compaction failed", error);
        return { summary: "", removedCount: 0 };
    }
}

export default {
    isOverflow,
    calculatePruneTarget,
    estimateTokens,
    getCompactionPrompt,
    isProtectedTool,
    getContextUsagePercent,
    getCompactionRecommendation,
    compactMessages,
    PRUNE_MINIMUM,
    PRUNE_PROTECT,
    PRUNE_PROTECTED_TOOLS,
};
