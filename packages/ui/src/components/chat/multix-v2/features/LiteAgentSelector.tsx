/**
 * LiteAgentSelector - Non-reactive agent selector for MultiX v2
 * 
 * Uses polling instead of reactive subscriptions to prevent cascading updates.
 * Includes AI Agent Generator feature.
 */

import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { agents, setAgents, providers } from "@/stores/session-state";
import { fetchAgents } from "@/stores/session-api";
import { updateInstanceConfig } from "@/stores/instance-config";
import { toast } from "solid-toast";
import { ChevronDown, Bot, Plus, Sparkles, Loader2, Save, X, RefreshCw } from "lucide-solid";
import { serverApi } from "@/lib/api-client";

interface LiteAgentSelectorProps {
    instanceId: string;
    sessionId: string;
    currentAgent: string;
    onAgentChange: (agent: string) => void;
}

interface AgentInfo {
    name: string;
    description?: string;
    systemPrompt?: string;
}

export function LiteAgentSelector(props: LiteAgentSelectorProps) {
    const [isOpen, setIsOpen] = createSignal(false);
    const [agentList, setAgentList] = createSignal<AgentInfo[]>([]);
    const [isGenerating, setIsGenerating] = createSignal(false);
    const [showGenerator, setShowGenerator] = createSignal(false);
    const [generatorInput, setGeneratorInput] = createSignal("");
    const [generatedAgent, setGeneratedAgent] = createSignal<AgentInfo | null>(null);
    const [isSaving, setIsSaving] = createSignal(false);
    const [selectedModel, setSelectedModel] = createSignal("glm-4");
    const [availableModels, setAvailableModels] = createSignal<{ id: string, name: string, provider: string }[]>([]);

    // Load agents once on mount, then poll
    function loadAgents() {
        try {
            const instanceAgents = agents().get(props.instanceId) || [];
            const nonSubagents = instanceAgents.filter((a: any) => a.mode !== "subagent");
            setAgentList(nonSubagents.map((a: any) => ({
                name: a.name,
                description: a.description,
                systemPrompt: a.systemPrompt
            })));
        } catch (e) {
            console.warn("Failed to load agents", e);
        }
    }

    onMount(() => {
        loadAgents();

        // Populate available models
        const allProviders = providers().get(props.instanceId) || [];
        const models: { id: string, name: string, provider: string }[] = [];
        allProviders.forEach(p => {
            p.models.forEach(m => {
                models.push({ id: m.id, name: m.name || m.id, provider: p.id });
            });
        });

        // Add defaults if none found
        if (models.length === 0) {
            models.push({ id: "glm-4", name: "GLM-4 (Z.AI)", provider: "zai" });
            models.push({ id: "qwen-coder-plus-latest", name: "Qwen Coder Plus (Zen)", provider: "opencode-zen" });
            models.push({ id: "minimax-m1", name: "MiniMax M1 (Ollama)", provider: "ollama" });
        }
        setAvailableModels(models);

        // Poll every 5 seconds (agents don't change often)
        const interval = setInterval(loadAgents, 5000);
        onCleanup(() => clearInterval(interval));
    });

    const handleSelect = (agentName: string) => {
        props.onAgentChange(agentName);
        setIsOpen(false);
    };

    const handleGenerateAgent = async () => {
        const input = generatorInput().trim();
        if (!input || isGenerating()) return;

        setIsGenerating(true);
        const modelInfo = availableModels().find(m => m.id === selectedModel());

        // Normalize provider ID - handle variants like "ollama-cloud" -> "ollama"
        let provider = modelInfo?.provider || "zai";
        if (provider.includes("ollama")) provider = "ollama";
        if (provider.includes("zen")) provider = "opencode-zen";

        console.log(`[AgentGenerator] Using provider: ${provider}, model: ${selectedModel()}`);

        // AI generation prompt - focused on unique, creative output
        const generationPrompt = `Create a unique AI coding assistant agent based on: "${input}"

RULES:
1. NAME: Create a catchy, memorable 1-3 word name (e.g., "Neon Architect", "Logic Ghost", "Cortex", "Syntax Specter"). BE CREATIVE!
2. DESCRIPTION: One powerful sentence about their unique paradigm or specialty.
3. SYSTEM PROMPT: Write a 400+ word deep-dive into their psyche, expertise, and operational style. 
   - DO NOT be generic. 
   - Give them a clear VOICE and philosophy.
   - Professional, yet distinct.
   - Mention specific methodologies they favor.
   - Explain how they view the relationship between code and problem-solving.

IMPORTANT: Return ONLY valid JSON in this format:
{"name": "...", "description": "...", "systemPrompt": "..."}`;

        const endpoints: Record<string, string> = {
            "zai": "/api/zai/chat",
            "opencode-zen": "/api/opencode-zen/chat",
            "ollama": "/api/ollama/chat"
        };

        // Timeout wrapper for fetch with 60 second limit
        const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 60000) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                return response;
            } catch (e) {
                clearTimeout(timeoutId);
                throw e;
            }
        };

        const tryEndpoint = async (prov: string, model: string) => {
            try {
                console.log(`[AgentGenerator] Attempting generation with ${prov}/${model}...`);

                // Use absolute URL from serverApi to avoid port issues
                const baseUrl = serverApi.getApiBase();
                const endpoint = `${baseUrl}${endpoints[prov]}`;

                if (!endpoints[prov]) {
                    console.warn(`[AgentGenerator] No endpoint configured for provider: ${prov}`);
                    return null;
                }

                const response = await fetchWithTimeout(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: generationPrompt }],
                        stream: false
                    })
                }, 60000); // 60 second timeout

                if (response.ok) {
                    const data = await response.json();
                    const content = prov === "zai" || prov === "opencode-zen"
                        ? (data?.choices?.[0]?.message?.content || data?.message?.content || "")
                        : (data?.message?.content || "");

                    console.log(`[AgentGenerator] Received content from ${prov}:`, content.substring(0, 100) + "...");

                    const result = tryParseAgentJson(content, input);
                    if (result) return result;

                    console.warn(`[AgentGenerator] Failed to parse JSON from ${prov} response`);
                } else {
                    const errText = await response.text();
                    console.error(`[AgentGenerator] Endpoint ${prov} returned ${response.status}:`, errText);
                }
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    console.warn(`[AgentGenerator] Request to ${prov} timed out after 60s`);
                    toast.error(`Generation timed out. Try a faster model.`, { duration: 5000 });
                } else {
                    console.warn(`[AgentGenerator] Endpoint ${prov} failed:`, e);
                }
            }
            return null;
        };

        // 1. Try selected model
        let parsed = await tryEndpoint(provider, selectedModel());

        // 2. Fallbacks if selected fails - try faster models
        if (!parsed) {
            console.log("[AgentGenerator] Selected model failed, trying fallbacks...");
            const fallbacks = [
                { prov: "ollama", model: "qwen3:8b" },
                { prov: "opencode-zen", model: "qwen-coder-plus-latest" },
                { prov: "zai", model: "glm-4" },
            ].filter(f => f.model !== selectedModel());

            for (const f of fallbacks) {
                parsed = await tryEndpoint(f.prov, f.model);
                if (parsed) break;
            }
        }

        if (parsed) {
            setGeneratedAgent(parsed);
            toast.success("Agent generated!", { icon: "🎉", duration: 3000 });
        } else {
            console.warn("[AgentGenerator] All AI endpoints failed, using smart fallback");
            setGeneratedAgent(generateSmartFallback(input));
            toast.success("Agent created (local fallback)", { duration: 3000 });
        }

        setIsGenerating(false);
    };

    // Try to parse JSON from AI response
    const tryParseAgentJson = (content: string, input: string): { name: string; description: string; systemPrompt: string } | null => {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.name && parsed.systemPrompt && parsed.systemPrompt.length > 100) {
                    return {
                        name: parsed.name,
                        description: parsed.description || input,
                        systemPrompt: parsed.systemPrompt
                    };
                }
            }
        } catch (e) {
            console.error("JSON parse error:", e);
        }
        return null;
    };

    // Generate a smart fallback that actually feels unique
    const generateSmartFallback = (input: string): { name: string; description: string; systemPrompt: string } => {
        const name = generateFallbackName(input);
        const timestamp = Date.now();

        // Create unique content based on input analysis
        const inputLower = input.toLowerCase();
        const isFrontend = /react|vue|angular|css|html|ui|frontend|web/.test(inputLower);
        const isBackend = /api|server|node|python|database|backend/.test(inputLower);
        const isFullStack = /full.?stack|complete|everything/.test(inputLower);
        const isAI = /ai|ml|machine|learning|neural|gpt|claude|llm/.test(inputLower);
        const isDevOps = /devops|docker|kubernetes|ci|cd|deploy/.test(inputLower);

        let specialty = "general software development";
        let techStack = "JavaScript, TypeScript, Python";
        let uniqueTrait = "methodical approach to problem-solving";

        if (isFrontend) {
            specialty = "frontend architecture and user experience";
            techStack = "React, Vue, TypeScript, CSS, Tailwind";
            uniqueTrait = "pixel-perfect attention to detail and smooth animations";
        } else if (isBackend) {
            specialty = "backend systems and API design";
            techStack = "Node.js, Python, PostgreSQL, Redis, GraphQL";
            uniqueTrait = "building scalable, fault-tolerant services";
        } else if (isFullStack) {
            specialty = "end-to-end application development";
            techStack = "React, Node.js, PostgreSQL, Docker, AWS";
            uniqueTrait = "seamless integration between frontend and backend";
        } else if (isAI) {
            specialty = "AI/ML integration and prompt engineering";
            techStack = "Python, LangChain, OpenAI, HuggingFace, Vector DBs";
            uniqueTrait = "crafting intelligent, context-aware AI solutions";
        } else if (isDevOps) {
            specialty = "infrastructure and deployment automation";
            techStack = "Docker, Kubernetes, Terraform, GitHub Actions, AWS";
            uniqueTrait = "zero-downtime deployments and infrastructure as code";
        }

        return {
            name,
            description: `Expert in ${specialty} with ${uniqueTrait}`,
            systemPrompt: `You are ${name}, a senior software engineer with 10+ years of expertise in ${specialty}.

## Your Personality
You are confident but humble, always explaining your reasoning clearly. You prefer elegant, maintainable solutions over clever hacks. When you don't know something, you say so honestly and suggest ways to find the answer.

## Technical Expertise
Your primary stack: ${techStack}
Your specialty: ${specialty}
Your unique strength: ${uniqueTrait}

## How You Work
1. **Understand First**: Before writing code, you analyze the existing codebase structure, patterns, and conventions
2. **Plan Carefully**: You outline your approach before implementing, considering edge cases and potential issues
3. **Code Quality**: Every line you write follows best practices - clean naming, proper error handling, comprehensive types
4. **Test Thinking**: You consider how code will be tested, even if tests aren't explicitly requested
5. **Documentation**: You add meaningful comments for complex logic, not obvious operations

## Code Standards You Follow
- Use descriptive variable and function names that reveal intent
- Keep functions small and focused (single responsibility)
- Handle errors gracefully with informative messages
- Prefer composition over inheritance
- Write self-documenting code, supplement with comments only where needed
- Always consider performance implications

## Communication Style
- Be direct and actionable in your responses
- When suggesting changes, explain WHY not just WHAT
- If multiple approaches exist, briefly mention pros/cons
- Celebrate good code when you see it
- Provide constructive feedback on improvements

## Tool Usage
- Use read_file to understand existing code before modifying
- Use list_files to understand project structure
- Use write_file to create or update files with complete, working code
- Always verify syntax correctness before submitting

Built for: ${input}
Session ID: ${timestamp}`
        };
    };

    // Generate a professional fallback name from user input
    const generateFallbackName = (input: string): string => {
        // Extract key words and create a professional sounding name
        const words = input.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        // Common tech keywords to look for
        const keywords: Record<string, string> = {
            'typescript': 'TypeScript Pro',
            'javascript': 'JS Expert',
            'react': 'React Master',
            'python': 'Python Guru',
            'api': 'API Architect',
            'code': 'Code Expert',
            'full': 'Full Stack Pro',
            'frontend': 'Frontend Master',
            'backend': 'Backend Pro',
            'mcp': 'MCP Specialist',
            'agent': 'Smart Agent',
            'thinking': 'Deep Thinker',
            'claude': 'AI Assistant',
            'smart': 'Smart Coder',
            'fix': 'Bug Hunter',
            'test': 'Test Master',
            'debug': 'Debug Pro',
            'architect': 'Code Architect',
            'review': 'Code Reviewer'
        };

        // Try to find a matching keyword
        for (const word of words) {
            for (const [key, name] of Object.entries(keywords)) {
                if (word.includes(key)) {
                    return name;
                }
            }
        }

        // Default: Create from first few words
        const titleWords = words.slice(0, 2).map(w =>
            w.charAt(0).toUpperCase() + w.slice(1)
        );
        return titleWords.length > 0 ? titleWords.join(' ') + ' Pro' : 'Custom Agent';
    }

    // Generate a sophisticated fallback prompt when API fails
    const generateFallbackPrompt = (description: string): string => {
        return `# ${description}

## IDENTITY & CORE MISSION
You are a world-class AI coding assistant specialized in: ${description}. You combine deep technical expertise with exceptional problem-solving abilities to deliver production-ready code that exceeds professional standards.

## CODEBASE AWARENESS PROTOCOL
Before writing any code, you MUST:
1. **Analyze Context**: Understand the existing project structure, patterns, and conventions
2. **Identify Dependencies**: Check package.json, imports, and installed libraries
3. **Match Style**: Adapt your output to the existing code style in the project
4. **Verify Compatibility**: Ensure new code integrates seamlessly with existing modules

## TECHNICAL EXPERTISE
- **Languages**: JavaScript, TypeScript, Python, and relevant frameworks
- **Patterns**: SOLID principles, DRY, KISS, Clean Architecture
- **Testing**: TDD approach, comprehensive test coverage
- **Documentation**: Clear comments, JSDoc/TSDoc, README updates

## CODING STANDARDS
1. **Naming**: Use descriptive, intention-revealing names
2. **Functions**: Single responsibility, max 20-30 lines per function
3. **Error Handling**: Always handle errors gracefully with informative messages
4. **Types**: Prefer strict typing, avoid \`any\` type
5. **Comments**: Explain WHY, not WHAT (the code explains what)

## ARCHITECTURAL PRINCIPLES
- Favor composition over inheritance
- Implement proper separation of concerns
- Design for extensibility and maintainability
- Consider performance implications of design choices
- Apply appropriate design patterns (Factory, Strategy, Observer, etc.)

## COMMUNICATION STYLE
- Be concise but thorough in explanations
- Provide rationale for technical decisions
- Offer alternatives when relevant
- Acknowledge limitations and edge cases
- Use code examples to illustrate concepts

## TOOL USAGE
When modifying the codebase:
1. Use \`read_file\` to understand existing code before making changes
2. Use \`list_files\` to understand project structure
3. Use \`write_file\` to create or update files with complete, working code
4. Always verify your changes are syntactically correct
5. Consider impact on other files that may need updates

## OUTPUT QUALITY STANDARDS
Every piece of code you generate must be:
- ✅ Syntactically correct and immediately runnable
- ✅ Following existing project conventions
- ✅ Properly typed (if TypeScript)
- ✅ Including necessary imports
- ✅ Handling edge cases and errors
- ✅ Well-documented where appropriate

You are committed to excellence and take pride in delivering code that professionals would admire.`
    }

    const handleSaveAgent = async () => {
        const agent = generatedAgent();
        if (!agent || isSaving()) return;

        setIsSaving(true);
        const toastId = toast.loading("Saving agent...");

        try {
            // Save to backend
            const response = await fetch(`/api/workspaces/${props.instanceId}/agents`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: agent.name,
                    description: agent.description,
                    systemPrompt: agent.systemPrompt,
                    mode: "agent"
                })
            });

            if (response.ok) {
                // CRITICAL: Update local instance config to keep it in sync with backend
                // This is the source of truth that fetchAgents() reads from
                await updateInstanceConfig(props.instanceId, (draft) => {
                    if (!draft.customAgents) {
                        draft.customAgents = [];
                    }
                    const existingIndex = draft.customAgents.findIndex(a => a.name === agent.name);
                    const agentData = {
                        name: agent.name,
                        description: agent.description || "",
                        prompt: agent.systemPrompt || ""
                    };
                    if (existingIndex >= 0) {
                        draft.customAgents[existingIndex] = agentData;
                    } else {
                        draft.customAgents.push(agentData);
                    }
                });

                // Fetch fresh agents from backend to update global signals
                await fetchAgents(props.instanceId);

                // Refresh local agent list
                loadAgents();

                // Manual update to ensure immediate feedback (fix for list lag)
                setAgentList(prev => {
                    if (prev.some(a => a.name === agent.name)) return prev;
                    return [...prev, { name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt }];
                });

                // Select the new agent
                props.onAgentChange(agent.name);

                toast.success(`Agent "${agent.name}" saved and activated!`, { id: toastId });

                // Close generator
                setShowGenerator(false);
                setGeneratedAgent(null);
                setGeneratorInput("");
                setIsOpen(false);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error("Failed to save agent:", response.status, errorData);
                toast.error(`Failed to save agent: ${errorData.error || response.statusText}`, { id: toastId });
            }
        } catch (error) {
            console.error("Failed to save agent:", error);
            toast.error("Network error while saving agent", { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div class="relative">
            <button
                onClick={() => setIsOpen(!isOpen())}
                class="flex items-center justify-between w-full px-3 py-2 bg-zinc-900/60 border border-white/10 rounded-lg text-left hover:border-indigo-500/30 transition-all"
            >
                <div class="flex items-center gap-2">
                    <Bot size={14} class="text-indigo-400" />
                    <span class="text-[11px] font-bold text-zinc-200 truncate">
                        {props.currentAgent || "Select Agent"}
                    </span>
                </div>
                <ChevronDown size={12} class={`text-zinc-500 transition-transform ${isOpen() ? "rotate-180" : ""}`} />
            </button>

            <Show when={isOpen()}>
                <div class="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-[80vh] overflow-y-auto">
                    {/* Agent Generator Toggle */}
                    <button
                        onClick={() => setShowGenerator(!showGenerator())}
                        class="w-full px-3 py-2 text-left hover:bg-indigo-500/10 transition-colors flex items-center gap-2 border-b border-white/5 text-indigo-400"
                    >
                        <Sparkles size={12} />
                        <span class="text-[11px] font-bold">AI Agent Generator</span>
                        <Plus size={12} class="ml-auto" />
                    </button>

                    {/* Generator Panel */}
                    <Show when={showGenerator()}>
                        <div class="p-3 border-b border-white/10 bg-zinc-950/50 space-y-3">
                            <div class="space-y-1">
                                <div class="text-[10px] text-zinc-400 font-medium">Generation Model:</div>
                                <select
                                    value={selectedModel()}
                                    onChange={(e) => setSelectedModel(e.currentTarget.value)}
                                    class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-indigo-500/50"
                                >
                                    <For each={availableModels()}>
                                        {(model) => (
                                            <option value={model.id}>{model.name}</option>
                                        )}
                                    </For>
                                </select>
                            </div>

                            <div class="text-[10px] text-zinc-400 font-medium">
                                Describe the agent you want to create:
                            </div>
                            <textarea
                                value={generatorInput()}
                                onInput={(e) => setGeneratorInput(e.currentTarget.value)}
                                placeholder="e.g., A TypeScript expert who focuses on clean code and best practices..."
                                class="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder-zinc-600 resize-none outline-none focus:border-indigo-500/50"
                                rows={3}
                            />
                            <div class="flex items-center gap-2">
                                <button
                                    onClick={handleGenerateAgent}
                                    disabled={!generatorInput().trim() || isGenerating()}
                                    class="flex-1 px-3 py-1.5 bg-indigo-500/20 border border-indigo-500/40 rounded-lg text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <Show when={isGenerating()} fallback={<Sparkles size={12} />}>
                                        <Loader2 size={12} class="animate-spin" />
                                    </Show>
                                    {isGenerating() ? "Generating..." : "Generate Agent"}
                                </button>
                            </div>

                            {/* Generated Agent Preview */}
                            <Show when={generatedAgent()}>
                                <div class="bg-zinc-800/50 rounded-lg p-3 border border-emerald-500/30 space-y-2">
                                    <div class="flex items-center justify-between">
                                        <span class="text-[10px] font-bold text-emerald-400">Generated Agent</span>
                                        <button
                                            onClick={() => setGeneratedAgent(null)}
                                            class="text-zinc-500 hover:text-zinc-300"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                    <div class="text-[12px] font-bold text-zinc-100">{generatedAgent()?.name}</div>
                                    <div class="text-[10px] text-zinc-400">{generatedAgent()?.description}</div>
                                    <div class="text-[9px] text-zinc-400 max-h-60 overflow-y-auto whitespace-pre-wrap font-mono bg-black/20 p-2 rounded border border-white/5">
                                        {generatedAgent()?.systemPrompt}
                                    </div>
                                    <button
                                        onClick={handleSaveAgent}
                                        disabled={isSaving()}
                                        class="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-[11px] font-bold transition-all shadow-lg active:scale-95"
                                    >
                                        <Show when={isSaving()} fallback={<Save size={14} />}>
                                            <Loader2 size={14} class="animate-spin" />
                                        </Show>
                                        {isSaving() ? "Saving..." : "Save & Use Agent"}
                                    </button>
                                </div>
                            </Show>
                        </div>
                    </Show>

                    {/* Agent List */}
                    <div class="px-3 py-1.5 flex items-center justify-between border-t border-white/5 bg-zinc-950/30">
                        <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Saved Agents</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); loadAgents(); fetchAgents(); }}
                            class="p-1 hover:bg-white/5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="Refresh agents"
                        >
                            <RefreshCw size={10} />
                        </button>
                    </div>
                    <div class="max-h-48 overflow-y-auto custom-scrollbar">
                        <For each={agentList()}>
                            {(agent) => (
                                <button
                                    onClick={() => handleSelect(agent.name)}
                                    class={`w-full px-3 py-2 text-left hover:bg-white/5 transition-colors flex items-center gap-2 ${props.currentAgent === agent.name ? "bg-indigo-500/10 text-indigo-300" : "text-zinc-300"
                                        }`}
                                >
                                    <Bot size={12} class="text-zinc-500" />
                                    <div class="min-w-0">
                                        <div class="text-[11px] font-bold truncate">{agent.name}</div>
                                        {agent.description && (
                                            <div class="text-[9px] text-zinc-500 truncate">{agent.description}</div>
                                        )}
                                    </div>
                                </button>
                            )}
                        </For>
                        <Show when={agentList().length === 0}>
                            <div class="px-3 py-2 text-[10px] text-zinc-600">No agents available</div>
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    );
}
