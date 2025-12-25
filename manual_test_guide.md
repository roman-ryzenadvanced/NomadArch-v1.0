# MultiX v2 - Verification & User Guide

**Date:** 2025-12-25
**Version:** 2.0.0 (Gold Master)

---

## 1. Feature Verification Guide

### A. Core Multi-Tasking & Parallel Execution
*   **Goal:** Verify you can run multiple agents at once without freezing.
*   **Steps:**
    1.  Create **Task 1**. Type "Write a long story about space" and hit Launch.
    2.  *While Task 1 is streaming*, click the **+** button to create **Task 2**.
    3.  Type "Write a python script for fibonacci" in Task 2 and hit Launch.
    4.  **Result:** Both tasks should stream simultaneously. Switching tabs should be instant.

### B. Per-Task Isolation (Agents & Models)
*   **Goal:** Verify each task retains its own settings.
*   **Steps:**
    1.  Go to **Task 1**. Select Agent: **"Software Engineer"** and Model: **"minimax-m2"**.
    2.  Go to **Task 2**. Select Agent: **"Writer"** and Model: **"deepseek-chat"**.
    3.  Switch back and forth.
    4.  **Result:** The selectors should update to reflect the saved state for each task.

### C. AI Agent Generator (NEW)
*   **Goal:** Create a custom agent using AI.
*   **Steps:**
    1.  Open the **Agent Selector** dropdown.
    2.  Click **"✨ AI Agent Generator"**.
    3.  Type: *"A rust expert who is sarcastic and funny"*.
    4.  Click **"Generate Agent"**.
    5.  Review the generated name, description, and system prompt.
    6.  Click **"Save & Use Agent"**.
    7.  **Result:** The new agent is saved and immediately selected.

### D. Prompt Enhancer
*   **Goal:** strict Opus 4.5 prompt optimization.
*   **Steps:**
    1.  Type a simple prompt: *"fix bug"*.
    2.  Click the **Magic Wand (✨)** button in the input area.
    3.  **Result:** The prompt is expanded into a professional, structured request using the active model.

### E. Compaction System
*   **Goal:** Manage context window usage.
*   **Steps:**
    1.  In a long chat, look for the **"Compact suggested"** banner at the top of the chat list.
    2.  Click **"Compact"** in the banner or the header bar.
    3.  **Result:** The session history is summarized, freeing up tokens while keeping context.

---

## 2. Menu & Wiring Check

| Button | Wired Action | Status |
|--------|--------------|--------|
| **MULTIX Badge** | Visual Indicator | ✅ Active |
| **SKILLS** | Opens Sidebar (Events) | ✅ Wired |
| **Active Task** | Shows current task name | ✅ Wired |
| **Pipeline Tab** | Switches to Dashboard | ✅ Wired |
| **Task Tabs** | Switch/Close Tasks | ✅ Wired |
| **Compact Btn** | Triggers Compaction | ✅ Wired |
| **API Key Btn** | Opens Settings Modal | ✅ Wired |
| **Agent Select** | Updates Task Session | ✅ Wired |
| **Model Select** | Updates Task Session | ✅ Wired |

---

## 3. Technical Status

*   **Build:** Passing (No TypeScript errors).
*   **Dev Server:** Running on port 3001.
*   **Architecture:** Polling-based (150ms sync) to prevent UI thread blocking.
*   **State:** Local signals + Non-reactive store references.

**Ready for deployment.**
