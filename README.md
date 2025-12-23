<!--
NomadArch - Advanced AI Coding Workspace
SEO Optimized: AI coding assistant, multi-model support, GLM 4.7, Z.AI API, autonomous coding, TypeScript, Electron
-->
<meta name="description" content="NomadArch - Advanced AI-powered coding workspace with multi-model support including GLM 4.7, Anthropic Claude, OpenAI GPT, and local Ollama models. Autonomous coding, real-time streaming, and intelligent code fixes.">
<meta name="keywords" content="AI coding assistant, GLM 4.7, Z.AI API, multi-model AI, autonomous coding, code generation, TypeScript, Electron, SolidJS, OpenAI, Anthropic, Qwen, Ollama">
<meta name="author" content="NeuralNomadsAI">
<meta name="robots" content="index, follow">

<meta property="og:title" content="NomadArch - Advanced AI Coding Workspace with GLM 4.7">
<meta property="og:description" content="Multi-model AI coding assistant featuring GLM 4.7, Claude, GPT, and local models. Autonomous coding, real-time streaming, intelligent fixes.">
<meta property="og:image" content="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/raw/main/packages/ui/src/images/CodeNomad-Icon.png">
<meta property="og:type" content="website">
<meta property="og:url" content="https://github.com/roman-ryzenadvanced/NomadArch-v1.0">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="NomadArch - Advanced AI Coding Workspace">
<meta name="twitter:description" content="Multi-model AI coding assistant featuring GLM 4.7, Claude, GPT, and local models.">
<meta name="twitter:image" content="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/raw/main/packages/ui/src/images/CodeNomad-Icon.png">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "NomadArch",
  "operatingSystem": "Windows, macOS, Linux",
  "applicationCategory": "DeveloperApplication",
  "description": "Advanced AI-powered coding workspace with multi-model support including GLM 4.7, Anthropic Claude, OpenAI GPT, and local Ollama models",
  "author": {
    "@type": "Organization",
    "name": "NeuralNomadsAI"
  },
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "Multi-provider AI support",
    "GLM 4.7 integration via Z.AI API",
    "Autonomous coding with APEX mode",
    "Real-time token streaming",
    "Intelligent code fixes",
    "Ollama local model support"
  ],
  "softwareVersion": "1.0.0"
}
</script>

# NomadArch

<p align="center">
  <img src="packages/ui/src/images/CodeNomad-Icon.png" alt="NomadArch Logo" width="180" height="180">
</p>

<h3 align="center">NomadArch - Advanced AI Coding Workspace</h3>

<p align="center">
  <strong>Fork of CodeNomad by OpenCode</strong>
</p>

<p align="center">
  <a href="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/stargazers">
    <img src="https://img.shields.io/github/stars/roman-ryzenadvanced/NomadArch-v1.0?style=social" alt="GitHub Stars">
  </a>
  <a href="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/network/members">
    <img src="https://img.shields.io/github/forks/roman-ryzenadvanced/NomadArch-v1.0?style=social" alt="GitHub Forks">
  </a>
  <a href="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/roman-ryzenadvanced/NomadArch-v1.0" alt="License">
  </a>
  <a href="https://github.com/roman-ryzenadvanced/NomadArch-v1.0/releases">
    <img src="https://img.shields.io/github/v/release/roman-ryzenadvanced/NomadArch-v1.0" alt="Latest Release">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#supported-ai-models">AI Models</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#whats-new">What's New</a> •
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://github.com/roman-ryzenadvanced/NomadArch-v1.0">
    <img src="https://img.shields.io/badge/Star%20this%20repo-%E2%AD%90-yellow?style=for-the-badge" alt="Star this repo">
  </a>
</p>

---

## Overview

NomadArch is an enhanced fork of CodeNomad by OpenCode, featuring significant UI/UX improvements, additional AI integrations, and a more robust architecture. This is a full-featured AI coding assistant with support for multiple AI providers including **GLM 4.7**, Anthropic, OpenAI, Google, Qwen, and local models via Ollama.

### Key Improvements Over CodeNomad
- Fixed Qwen OAuth authentication flow
- Enhanced MULTIX Mode with live token streaming
- Improved UI/UX with detailed tooltips
- Auto-build verification on launch
- Comprehensive installer scripts for all platforms
- Port conflict detection and resolution hints

---

## Supported AI Models & Providers

NomadArch supports a wide range of AI models from multiple providers, giving you flexibility to choose the best model for your coding tasks.

### 🚀 Featured Model: GLM 4.7 (Z.AI)

**GLM 4.7** is the latest state-of-the-art open model from Z.AI, now fully integrated into NomadArch. Released in December 2025, GLM 4.7 ranks **#1 for Web Development** and **#6 overall** on the LM Arena leaderboard.

#### Key Features
- 🔥 **128K Context Window** - Process entire codebases in a single session
- 🧠 **Interleaved Thinking** - Advanced reasoning with multi-step analysis
- 💭 **Preserved Thinking** - Maintains reasoning chain across long conversations
- 🔄 **Turn-level Thinking** - Optimized per-response reasoning for efficiency

#### Benchmark Performance
| Benchmark | Score | Improvement |
|-----------|-------|-------------|
| SWE-bench | **+73.8%** | Over GLM-4.6 |
| SWE-bench Multilingual | **+66.7%** | Over GLM-4.6 |
| Terminal Bench 2.0 | **+41%** | Over GLM-4.6 |
| LM Arena WebDev | **#1** | Open Model Ranking |
| LM Arena Overall | **#6** | Open Model Ranking |

GLM 4.7 beats GPT-5, Claude Sonnet, and Gemini on multiple coding benchmarks.

#### Z.AI API Integration
- ✅ Fully integrated via Z.AI Plan API
- ✅ Compatible with Claude Code, Cline, Roo Code, Kilo Code
- ✅ Get **10% discount** with code: [`R0K78RJKNW`](https://z.ai/subscribe?ic=R0K78RJKNW)
- 🎯 [Subscribe to Z.AI with 10% off](https://z.ai/subscribe?ic=R0K78RJKNW)

---

### 🤖 All Supported Models

#### Z.AI
| Model | Context | Specialty |
|-------|---------|-----------|
| **GLM 4.7** | 128K | Web Development, Coding |
| GLM 4.6 | 128K | General Coding |
| GLM-4 | 128K | Versatile |

#### Anthropic
| Model | Context | Specialty |
|-------|---------|-----------|
| Claude 3.7 Sonnet | 200K | Complex Reasoning |
| Claude 3.5 Sonnet | 200K | Balanced Performance |
| Claude 3 Opus | 200K | Maximum Quality |

#### OpenAI
| Model | Context | Specialty |
|-------|---------|-----------|
| GPT-5 Preview | 200K | Latest Capabilities |
| GPT-4.1 | 128K | Production Ready |
| GPT-4 Turbo | 128K | Fast & Efficient |

#### Google
| Model | Context | Specialty |
|-------|---------|-----------|
| Gemini 2.0 Pro | 1M+ | Massive Context |
| Gemini 2.0 Flash | 1M+ | Ultra Fast |

#### Qwen
| Model | Context | Specialty |
|-------|---------|-----------|
| Qwen 2.5 Coder | 32K | Code Specialized |
| Qwen 2.5 | 32K | General Purpose |

#### Local (Ollama)
| Model | Size | Specialty |
|-------|------|-----------|
| DeepSeek Coder | Varies | Code |
| Llama 3.1 | Varies | General |
| CodeLlama | Varies | Code |
| Mistral | Varies | General |

---

## Installation

### Quick Start (Recommended)

The installers will automatically install **OpenCode CLI** (required for workspace functionality) using:
1. **Primary**: `npm install -g opencode-ai@latest` (fastest)
2. **Fallback**: Download from official GitHub releases if npm fails

#### Windows
```batch
# Double-click and run
Install-Windows.bat

# Then start app
Launch-Windows.bat
```

#### Linux
```bash
chmod +x Install-Linux.sh
./Install-Linux.sh

# Then start app
./Launch-Unix.sh
```

#### macOS
```bash
chmod +x Install-Mac.sh
./Install-Mac.sh

# Then start app
./Launch-Unix.sh
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/roman-ryzenadvanced/NomadArch-v1.0.git
cd NomadArch

# Install dependencies
npm install

# Start the application
npm run dev:electron
```

### Building from Source

```bash
# Build all packages
npm run build

# Or build individual packages
npm run build:ui          # Build UI
npm run build:server       # Build server
npm run build:electron     # Build Electron app
```

---

## Features

### Core Features
- 🤖 **Multi-Provider AI Support** - GLM 4.7, Anthropic, OpenAI, Google, Qwen, Ollama (local)
- 🖥️ **Electron Desktop App** - Native feel with modern web technologies
- 📁 **Workspace Management** - Organize your projects efficiently
- 💬 **Real-time Streaming** - Live responses from AI models
- 🔧 **Smart Fix** - AI-powered code error detection and fixes
- 🏗️ **Build Integration** - One-click project builds
- 🔌 **Ollama Integration** - Run local AI models for privacy

### UI/UX Highlights
- ⚡ **MULTIX Mode** - Multi-task parallel AI conversations with live token counting
- 🛡️ **SHIELD Mode** - Auto-approval for hands-free operation
- 🚀 **APEX Mode** - Autonomous AI that chains tasks together
- 📊 **Live Token Counter** - Real-time token usage during streaming
- 💭 **Thinking Indicator** - Animated visual feedback when AI is processing
- 🎨 **Modern Dark Theme** - Beautiful, eye-friendly dark interface
- 🖱️ **Detailed Tooltips** - Hover over any button for explanations

---

## What's New in NomadArch

### Major Improvements Over Original CodeNomad

#### 🎨 Branding & Identity
- ✅ **New Branding**: "NomadArch" with proper attribution to OpenCode
- ✅ **Updated Loading Screen**: New branding with fork attribution
- ✅ **Updated Empty States**: All screens show NomadArch branding

#### 🔐 Qwen OAuth Integration
- ✅ **Fixed OAuth Flow**: Resolved "Body cannot be empty" error in Qwen authentication
- ✅ **Proper API Bodies**: POST requests now include proper JSON bodies
- ✅ **Fixed Device Poll Schema**: Corrected Fastify schema validation for OAuth polling

#### 🚀 MULTIX Mode Enhancements
- ✅ **Live Streaming Token Counter**: Visible in header during AI processing
- ✅ **Thinking Roller Indicator**: Animated indicator with bouncing dots
- ✅ **Token Stats Display**: Shows input/output tokens processed
- ✅ **Auto-Scroll**: Intelligent scrolling during streaming

#### 🖥️ UI/UX Improvements
- ✅ **Detailed Button Tooltips**: Hover over any button for detailed explanations
  - AUTHED: Authentication status explanation
  - AI MODEL: Model selection help
  - SMART FIX: AI code analysis feature
  - BUILD: Project compilation
  - APEX: Autonomous mode description
  - SHIELD: Auto-approval mode
  - MULTIX MODE: Multi-task interface
- ✅ **Bulletproof Layout**: Fixed layout issues with Editor/MultiX panels
- ✅ **Overflow Handling**: Long code lines don't break layout
- ✅ **Responsive Panels**: Editor and chat panels properly sized

#### 📂 File Editor Improvements
- ✅ **Proper File Loading**: Files load correctly when selected in explorer
- ✅ **Line Numbers**: Clean line number display
- ✅ **Word Wrap**: Long lines wrap instead of overflowing

#### 🔧 Developer Experience
- ✅ **Disabled Auto-Browser Open**: Dev server no longer opens browser automatically
- ✅ **Unified Installers**: One-click installers for Windows, Linux, and macOS
- ✅ **Enhanced Launchers**: Auto-fix capabilities, dependency checking, build verification
- ✅ **Port Conflict Detection**: Warns if default ports are in use
- ✅ **Error Recovery**: Provides actionable error messages with fixes

#### 🐛 Bug Fixes
- ✅ Fixed Qwen OAuth "empty body" errors
- ✅ Fixed MultiX panel being pushed off screen when Editor is open
- ✅ Fixed top menu/toolbar disappearing when file is selected
- ✅ Fixed layout breaking when scrolling in Editor or Chat
- ✅ Fixed auto-scroll interrupting manual scrolling
- ✅ Fixed sessions not showing on workspace first entry

---

## Button Features Guide

| Button | Description |
|--------|-------------|
| **AUTHED** | Shows authentication status. Green = connected, Red = not authenticated |
| **AI MODEL** | Click to switch between AI models (GLM 4.7, Claude, GPT, etc.) |
| **SMART FIX** | AI analyzes your code for errors and automatically applies fixes |
| **BUILD** | Compiles and builds your project using detected build system |
| **APEX** | Autonomous mode - AI chains actions without waiting for approval |
| **SHIELD** | Auto-approval mode - AI makes changes without confirmation prompts |
| **MULTIX MODE** | Opens multi-task pipeline for parallel AI conversations |

---

## Folder Structure

```
NomadArch/
├── Install-Windows.bat    # Windows installer with dependency checking
├── Install-Linux.sh       # Linux installer with distro support
├── Install-Mac.sh         # macOS installer with Apple Silicon support
├── Launch-Windows.bat     # Windows launcher with auto-fix
├── Launch-Dev-Windows.bat # Windows developer mode launcher
├── Launch-Unix.sh         # Linux/macOS launcher
├── packages/
│   ├── electron-app/      # Electron main process
│   ├── server/            # Backend server (Fastify)
│   ├── ui/                # Frontend (SolidJS + Vite)
│   ├── tauri-app/        # Tauri alternative desktop app
│   └── opencode-config/   # OpenCode configuration
├── README.md              # This file
└── package.json           # Root package manifest
```

---

## Requirements

- **Node.js**: v18 or higher
- **npm**: v9 or higher
- **Git**: For version control features
- **OS**: Windows 10+, macOS 11+ (Big Sur), or Linux (Ubuntu 20.04+, Fedora, Arch, OpenSUSE)

### Platform-Specific Requirements

**Windows**:
- Administrator privileges recommended for installation
- 2GB free disk space

**Linux**:
- Build tools (gcc, g++, make)
- Package manager (apt, dnf, pacman, or zypper)

**macOS**:
- Xcode Command Line Tools
- Homebrew (recommended)
- Rosetta 2 for Apple Silicon (for x86_64 compatibility)

---

## Troubleshooting

### "Dependencies not installed" Error
Run the installer script first:
- Windows: `Install-Windows.bat`
- Linux: `./Install-Linux.sh`
- macOS: `./Install-Mac.sh`

### "opencode not found" or Workspace Creation Fails
The installer should automatically install OpenCode CLI. If it fails:

**Option 1 - Manual npm install:**
```bash
npm install -g opencode-ai@latest
```

**Option 2 - Manual download:**
1. Visit: https://github.com/sst/opencode/releases/latest
2. Download the appropriate ZIP for your platform:
   - Windows: `opencode-windows-x64.zip`
   - Linux x64: `opencode-linux-x64.zip`
   - Linux ARM64: `opencode-linux-arm64.zip`
   - macOS Intel: `opencode-darwin-x64.zip`
   - macOS Apple Silicon: `opencode-darwin-arm64.zip`
3. Extract and place `opencode` or `opencode.exe` in the `bin/` folder

### Port 3000 or 3001 Already in Use
The launchers will detect port conflicts and warn you. To fix:
1. Close other applications using these ports
2. Check for running NomadArch instances
3. Kill the process: `taskkill /F /PID <PID>` (Windows) or `kill -9 <PID>` (Unix)

### Layout Issues
If the UI looks broken, try:
1. Refresh the app (Ctrl+R or Cmd+R)
2. Restart the application
3. Clear node_modules and reinstall: `rm -rf node_modules && npm install`

### OAuth Authentication Fails
1. Check your internet connection
2. Ensure you completed the OAuth flow in your browser
3. Try logging out and back in
4. Clear browser cookies for the OAuth provider

### Build Errors
1. Ensure you have the latest Node.js (18+)
2. Clear npm cache: `npm cache clean --force`
3. Delete node_modules: `rm -rf node_modules` (or `rmdir /s /q node_modules` on Windows)
4. Reinstall: `npm install`

### Sessions Not Showing on Workspace Entry
This has been fixed with SSE connection waiting. The app now waits for the Server-Sent Events connection to be established before fetching sessions.

---

## Credits

### Core Framework & Build Tools

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [SolidJS](https://www.solidjs.com/) | ^1.8.0 | Reactive JavaScript UI framework | MIT |
| [Vite](https://vitejs.dev/) | ^5.0.0 | Next-generation frontend build tool | MIT |
| [TypeScript](https://www.typescriptlang.org/) | ^5.3.0 - 5.6.3 | JavaScript with type system | Apache-2.0 |
| [Electron](https://www.electronjs.org/) | Via electron-app | Cross-platform desktop app framework | MIT |
| [Tauri](https://tauri.app/) | Via tauri-app | Alternative desktop app framework | Apache-2.0/MIT |

### UI Components & Styling

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [@suid/material](https://suid.io/) | ^0.19.0 | Material Design components for SolidJS | MIT |
| [@suid/icons-material](https://suid.io/) | ^0.9.0 | Material Design icons for SolidJS | MIT |
| [@suid/system](https://suid.io/) | ^0.14.0 | System components for SolidJS | MIT |
| [@kobalte/core](https://kobalte.dev/) | 0.13.11 | Accessible, unstyled UI components | MIT |
| [TailwindCSS](https://tailwindcss.com/) | ^3.0.0 | Utility-first CSS framework | MIT |
| [PostCSS](https://postcss.org/) | ^8.5.6 | CSS transformation tool | MIT |
| [Autoprefixer](https://github.com/postcss/autoprefixer) | ^10.4.21 | Parse CSS and add vendor prefixes | MIT |

### Routing & State Management

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [@solidjs/router](https://github.com/solidjs/solid-router) | ^0.13.0 | Router for SolidJS | MIT |

### Markdown & Code Display

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Marked](https://marked.js.org/) | ^12.0.0 | Markdown parser and compiler | MIT |
| [GitHub Markdown CSS](https://github.com/sindresorhus/github-markdown-css) | ^5.8.1 | Markdown styling from GitHub | MIT |
| [Shiki](https://shiki.style/) | ^3.13.0 | Syntax highlighting | MIT |
| [@git-diff-view/solid](https://github.com/git-diff-view/git-diff-view) | ^0.0.8 | Git diff visualization for SolidJS | MIT |

### Icons & Visuals

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Lucide Solid](https://lucide.dev/) | ^0.300.0 | Beautiful & consistent icon toolkit | ISC |
| [QRCode](https://github.com/soldair/node-qrcode) | ^1.5.3 | QR code generation | MIT |

### Backend & Server

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Fastify](https://www.fastify.io/) | ^4.28.1 | Fast and low overhead web framework | MIT |
| [@fastify/cors](https://github.com/fastify/fastify-cors) | ^8.5.0 | CORS support for Fastify | MIT |
| [@fastify/reply-from](https://github.com/fastify/fastify-reply-from) | ^9.8.0 | Proxy support for Fastify | MIT |
| [@fastify/static](https://github.com/fastify/fastify-static) | ^7.0.4 | Static file serving for Fastify | MIT |
| [Ollama](https://ollama.com/) | ^0.5.0 | Local AI model integration | MIT |

### AI & SDK

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [OpenCode CLI](https://github.com/sst/opencode) | v1.0.191 | Open source AI coding agent - Required for workspace functionality | MIT |
| [@opencode-ai/sdk](https://github.com/opencode/ai-sdk) | ^1.0.138 | OpenCode AI SDK | Custom |
| [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs) | ^10.5.0 | Google OAuth authentication | Apache-2.0 |

### HTTP & Networking

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Axios](https://axios-http.com/) | ^1.6.0 | Promise-based HTTP client | MIT |
| [undici](https://undici.nodejs.org/) | ^6.19.8 | HTTP/1.1 client for Node.js | MIT |
| [node-fetch](https://github.com/node-fetch/node-fetch) | ^3.3.2 | A light-weight module that brings window.fetch to Node.js | MIT |

### Utilities & Helpers

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Nanoid](https://github.com/ai/nanoid) | ^5.0.4 | Unique string ID generator | MIT |
| [Debug](https://github.com/debug-js/debug) | ^4.4.3 | Debug logging utility | MIT |
| [Pino](https://getpino.io/) | ^9.4.0 | Extremely fast Node.js logger | MIT |
| [FuzzySort](https://github.com/farzher/fuzzysort) | ^2.0.4 | Fuzzy search and sort | MIT |
| [Zod](https://zod.dev/) | ^3.23.8 | TypeScript-first schema validation | MIT |
| [Commander](https://github.com/tj/commander.js) | ^12.1.0 | Node.js command-line interface | MIT |
| [7zip-bin](https://github.com/felixrieseberg/7zip-bin) | ^5.2.0 | 7-Zip binary wrapper | MIT |

### Notifications & Feedback

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [solid-toast](https://github.com/ThisIsFlorian/solid-toast) | ^0.5.0 | Toast notifications for SolidJS | MIT |

### Desktop Integration

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [@tauri-apps/api](https://tauri.app/) | ^2.9.1 | Tauri API for desktop integration | Apache-2.0/MIT |
| [@tauri-apps/plugin-opener](https://tauri.app/) | ^2.5.2 | Tauri plugin for opening URLs/paths | Apache-2.0/MIT |

### Development Tools

| Project | Version | Description | License |
|----------|----------|-------------|----------|
| [Vite Plugin Solid](https://github.com/solidjs/vite-plugin-solid) | ^2.10.0 | Vite plugin for SolidJS | MIT |
| [ts-node](https://github.com/TypeStrong/ts-node) | ^10.9.2 | TypeScript execution and REPL | MIT |
| [tsx](https://github.com/privatenumber/tsx) | ^4.20.6 | TypeScript execution | MIT |
| [cross-env](https://github.com/kentcdodds/cross-env) | ^7.0.3 | Set environment variables across platforms | MIT |

---

## Project Fork

| Project | Repository | Description |
|----------|-------------|-------------|
| [CodeNomad](https://github.com/opencode/codenom) | OpenCode - Original AI coding workspace |
| [NomadArch](https://github.com/roman-ryzenadvanced/NomadArch-v1.0) | Enhanced fork by NeuralNomadsAI |

---

## License

This project is a fork of CodeNomad by OpenCode. Please refer to the original project for licensing information.

All third-party libraries listed above retain their respective licenses.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/NeuralNomadsAI">NeuralNomadsAI</a>
</p>

<p align="center">
  Forked from <a href="https://github.com/opencode/codenom">CodeNomad by OpenCode</a>
</p>
