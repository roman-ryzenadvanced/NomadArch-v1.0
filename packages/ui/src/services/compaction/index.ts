// Compaction Service Exports
export {
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
} from "./service";

export type {
    CompactionConfig,
    TokenInfo,
    PruneResult,
} from "./service";
