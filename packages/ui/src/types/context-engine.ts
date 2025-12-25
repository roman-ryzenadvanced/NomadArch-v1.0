/**
 * Context Engine Types
 * 
 * Type definitions for Context-Engine integration
 * Based on: https://github.com/Eskapeum/Context-Engine
 */

// ============================================================================
// PARSER TYPES
// ============================================================================

export interface CodeSymbol {
    name: string;
    kind: SymbolKind;
    filePath: string;
    startLine: number;
    endLine: number;
    signature?: string;
    documentation?: string;
    parent?: string;
    children?: string[];
}

export type SymbolKind =
    | "class"
    | "interface"
    | "function"
    | "method"
    | "property"
    | "variable"
    | "constant"
    | "enum"
    | "type"
    | "module"
    | "namespace";

export interface FileIndex {
    path: string;
    language: string;
    hash: string;
    lastModified: number;
    symbols: CodeSymbol[];
    imports: FileImport[];
    exports: string[];
}

export interface FileImport {
    source: string;
    specifiers: string[];
    isDefault: boolean;
    isNamespace: boolean;
}

// ============================================================================
// RETRIEVAL TYPES
// ============================================================================

export interface RetrievalQuery {
    text: string;
    maxResults?: number;
    maxTokens?: number;
    filters?: RetrievalFilters;
}

export interface RetrievalFilters {
    languages?: string[];
    paths?: string[];
    symbolKinds?: SymbolKind[];
    excludePaths?: string[];
}

export interface RetrievalResult {
    content: string;
    score: number;
    source: RetrievalSource;
    tokens: number;
}

export interface RetrievalSource {
    type: "code" | "documentation" | "memory";
    file?: string;
    line?: number;
    symbol?: string;
}

// ============================================================================
// INDEXER TYPES
// ============================================================================

export interface IndexerConfig {
    projectRoot: string;
    languages?: string[];
    excludePatterns?: string[];
    maxFileSize?: number;
    enableGitTracking?: boolean;
}

export interface IndexStats {
    filesIndexed: number;
    symbolsFound: number;
    totalTokens: number;
    lastUpdated: number;
    duration: number;
}

export interface IndexUpdateResult {
    added: string[];
    updated: string[];
    removed: string[];
    stats: IndexStats;
}

// ============================================================================
// MEMORY TYPES
// ============================================================================

export interface MemoryEntry {
    id: string;
    question: string;
    answer: string;
    timestamp: number;
    tags?: string[];
    relevance?: number;
}

export interface MemorySearchResult {
    entries: MemoryEntry[];
    totalCount: number;
}

// ============================================================================
// VECTOR STORE TYPES
// ============================================================================

export interface VectorDocument {
    id: string;
    content: string;
    embedding?: number[];
    metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
    id: string;
    score: number;
    content: string;
    metadata: Record<string, unknown>;
}

export interface EmbeddingProvider {
    name: string;
    dimensions: number;
    embed(texts: string[]): Promise<number[][]>;
}

// ============================================================================
// GRAPH TYPES
// ============================================================================

export interface GraphNode {
    id: string;
    type: NodeType;
    name: string;
    metadata: Record<string, unknown>;
}

export type NodeType = "file" | "symbol" | "import" | "export" | "dependency";

export interface GraphEdge {
    source: string;
    target: string;
    type: EdgeType;
    weight?: number;
}

export type EdgeType =
    | "contains"
    | "imports"
    | "exports"
    | "calls"
    | "extends"
    | "implements"
    | "depends_on";

export interface GraphQueryResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    paths?: GraphNode[][];
}
