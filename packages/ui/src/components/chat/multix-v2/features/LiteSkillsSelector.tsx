/**
 * LiteSkillsSelector - Non-reactive skills selector for MultiX v2
 * 
 * Uses polling instead of reactive subscriptions to prevent cascading updates.
 * Displays selected skills as chips with ability to add/remove.
 */

import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { catalog, catalogLoading, loadCatalog } from "@/stores/skills";
import { getSessionSkills, setSessionSkills } from "@/stores/session-state";
import { ChevronDown, Sparkles, X, Check, Loader2 } from "lucide-solid";
import type { SkillSelection } from "@/types/session";

interface LiteSkillsSelectorProps {
    instanceId: string;
    sessionId: string;
}

interface SkillInfo {
    id: string;
    name: string;
    description?: string;
}

export function LiteSkillsSelector(props: LiteSkillsSelectorProps) {
    const [isOpen, setIsOpen] = createSignal(false);
    const [skillList, setSkillList] = createSignal<SkillInfo[]>([]);
    const [selectedSkills, setSelectedSkills] = createSignal<SkillSelection[]>([]);
    const [isLoading, setIsLoading] = createSignal(false);
    const [filterText, setFilterText] = createSignal("");

    // Load skills once on mount, then poll
    function loadSkills() {
        try {
            const skills = catalog();
            setSkillList(skills.map((s) => ({
                id: s.id,
                name: s.name || s.id,
                description: s.description
            })));
        } catch (e) {
            console.warn("Failed to load skills", e);
        }
    }

    function loadSelected() {
        try {
            const skills = getSessionSkills(props.instanceId, props.sessionId);
            setSelectedSkills(skills);
        } catch (e) {
            console.warn("Failed to load selected skills", e);
        }
    }

    onMount(async () => {
        // Load catalog if not already loaded
        if (catalog().length === 0) {
            setIsLoading(true);
            await loadCatalog();
            setIsLoading(false);
        }
        loadSkills();
        loadSelected();

        // Poll every 2 seconds
        const interval = setInterval(() => {
            loadSkills();
            loadSelected();
        }, 2000);
        onCleanup(() => clearInterval(interval));
    });

    const toggleSkill = (skill: SkillInfo) => {
        const current = selectedSkills();
        const isSelected = current.some(s => s.id === skill.id);

        let next: SkillSelection[];
        if (isSelected) {
            next = current.filter(s => s.id !== skill.id);
        } else {
            next = [...current, { id: skill.id, name: skill.name, description: skill.description }];
        }

        setSelectedSkills(next);
        setSessionSkills(props.instanceId, props.sessionId, next);
    };

    const removeSkill = (id: string) => {
        const next = selectedSkills().filter(s => s.id !== id);
        setSelectedSkills(next);
        setSessionSkills(props.instanceId, props.sessionId, next);
    };

    const filteredSkills = () => {
        const term = filterText().toLowerCase().trim();
        if (!term) return skillList();
        return skillList().filter(s =>
            s.name.toLowerCase().includes(term) ||
            s.id.toLowerCase().includes(term) ||
            (s.description?.toLowerCase().includes(term) ?? false)
        );
    };

    const isSkillSelected = (id: string) => selectedSkills().some(s => s.id === id);

    return (
        <div class="relative w-full">
            {/* Main Button */}
            <button
                onClick={() => setIsOpen(!isOpen())}
                class="flex items-center justify-between w-full px-3 py-2 bg-zinc-900/60 border border-white/10 rounded-lg text-left hover:border-purple-500/30 transition-all"
            >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <Sparkles size={14} class="text-purple-400 shrink-0" />
                    <Show
                        when={selectedSkills().length > 0}
                        fallback={<span class="text-[11px] text-zinc-500">No skills</span>}
                    >
                        <div class="flex items-center gap-1 overflow-hidden">
                            <span class="text-[11px] font-bold text-purple-300">
                                {selectedSkills().length} skill{selectedSkills().length !== 1 ? 's' : ''}
                            </span>
                            <For each={selectedSkills().slice(0, 2)}>
                                {(skill) => (
                                    <span class="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded truncate max-w-[80px]">
                                        {skill.name}
                                    </span>
                                )}
                            </For>
                            <Show when={selectedSkills().length > 2}>
                                <span class="text-[10px] text-zinc-500">+{selectedSkills().length - 2}</span>
                            </Show>
                        </div>
                    </Show>
                </div>
                <ChevronDown size={12} class={`text-zinc-500 transition-transform shrink-0 ${isOpen() ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            <Show when={isOpen()}>
                <div class="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-80 overflow-hidden flex flex-col">
                    {/* Selected Skills Chips */}
                    <Show when={selectedSkills().length > 0}>
                        <div class="px-3 py-2 border-b border-white/5 flex flex-wrap gap-1">
                            <For each={selectedSkills()}>
                                {(skill) => (
                                    <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full text-[10px]">
                                        {skill.name}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeSkill(skill.id);
                                            }}
                                            class="hover:text-red-400"
                                        >
                                            <X size={10} />
                                        </button>
                                    </span>
                                )}
                            </For>
                        </div>
                    </Show>

                    {/* Filter Input */}
                    <div class="px-3 py-2 border-b border-white/5">
                        <input
                            type="text"
                            placeholder="Filter skills..."
                            value={filterText()}
                            onInput={(e) => setFilterText(e.currentTarget.value)}
                            class="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-purple-500/40"
                        />
                    </div>

                    {/* Skills List */}
                    <div class="overflow-y-auto flex-1 max-h-48">
                        <Show
                            when={!isLoading() && !catalogLoading()}
                            fallback={
                                <div class="px-3 py-4 text-center text-[11px] text-zinc-500 flex items-center justify-center gap-2">
                                    <Loader2 size={12} class="animate-spin" />
                                    Loading skills...
                                </div>
                            }
                        >
                            <Show
                                when={filteredSkills().length > 0}
                                fallback={
                                    <div class="px-3 py-4 text-center text-[11px] text-zinc-500">
                                        No skills found
                                    </div>
                                }
                            >
                                <For each={filteredSkills()}>
                                    {(skill) => (
                                        <button
                                            onClick={() => toggleSkill(skill)}
                                            class={`w-full px-3 py-2 text-left hover:bg-white/5 transition-colors flex items-center gap-2 ${isSkillSelected(skill.id) ? "bg-purple-500/10" : ""
                                                }`}
                                        >
                                            <div class={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSkillSelected(skill.id)
                                                    ? "bg-purple-500 border-purple-500"
                                                    : "border-white/20"
                                                }`}>
                                                <Show when={isSkillSelected(skill.id)}>
                                                    <Check size={10} class="text-white" />
                                                </Show>
                                            </div>
                                            <div class="flex-1 min-w-0">
                                                <div class={`text-[11px] font-medium truncate ${isSkillSelected(skill.id) ? "text-purple-300" : "text-zinc-300"
                                                    }`}>
                                                    {skill.name}
                                                </div>
                                                <Show when={skill.description}>
                                                    <div class="text-[10px] text-zinc-500 truncate">
                                                        {skill.description}
                                                    </div>
                                                </Show>
                                            </div>
                                        </button>
                                    )}
                                </For>
                            </Show>
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    );
}
