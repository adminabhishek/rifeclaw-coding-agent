# RifeClaw

RifeClaw is a Bun-powered TypeScript CLI that helps you explore and modify a local codebase with AI through guided local modes and an optional Telegram interface.

It supports:
- **OpenRouter** (cloud models)
- **Ollama** (local/offline model runtime)
- Optional **Firecrawl** tools for web search/crawl
- Optional **Telegram** bot workflows for remote interaction

> **Safety first:** file/folder/shell mutations are staged first and require explicit approval before they are applied.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [Modes](#modes)
- [Safety Model](#safety-model)
- [Verification & Troubleshooting](#verification--troubleshooting)
- [Development](#development)
- [Example App](#example-app)
- [Contributing](#contributing)

## Features

- Guided setup: `rifeclaw setup` creates/updates `.env` using interactive prompts.
- Health checks: `rifeclaw doctor` validates readiness and prints next steps.
- Interactive launcher: `rifeclaw` (no subcommand) opens the wakeup mode picker.
- CLI workflows:
  - **Ask Mode** (read-only codebase Q&A)
  - **Plan Mode** (structured plan + selectable execution)
  - **Agent Mode** (multi-step coding actions staged for approval)
- Optional Telegram workflows (`/ask`, `/plan`, `/agent`) for owner-only bot access.
- Works in the current directory or an explicit target via `--project <path>`.

## Requirements

- **Node.js 18+** (for installed CLI usage via npm/npx)
- **Bun** (for local development in this repository)
- One AI provider configured:
  - **OpenRouter API key**, or
  - **Ollama** installed/running locally
- Optional integrations:
  - **Firecrawl API key** (web search/crawl tools)
  - **Telegram bot token + owner ID** (Telegram mode)

## Installation

### Option A: Install per project (recommended)

From the project you want to work on:

```bash
npm install --save-dev rifeclaw
npx rifeclaw setup
npx rifeclaw doctor
npx rifeclaw
```

### Option B: Global install

```bash
npm install -g rifeclaw
cd my-project
rifeclaw setup
rifeclaw doctor
rifeclaw
```

### Option C: Point at another project

```bash
rifeclaw --project ../my-project setup
rifeclaw --project ../my-project doctor
rifeclaw --project ../my-project
```

## Quick Start

1. Run `rifeclaw setup` and choose your provider (OpenRouter or Ollama).
2. Run `rifeclaw doctor` to verify configuration.
3. Run `rifeclaw` and choose:
   - **CLI** → Agent / Plan / Ask sub-modes
   - **Telegram** → bot workflows (if configured)

## Configuration

Use guided setup first:

```bash
rifeclaw setup
```

This creates or updates `.env` in the target project.

### Environment variables

```bash
# AI provider: openrouter or ollama
AI_PROVIDER=openrouter

# OpenRouter settings
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1

# Ollama local settings
# AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_BASE_URL=http://localhost:11434/v1

# Optional web tools
FIRECRAWL_API_KEY=your_firecrawl_key

# Optional Telegram mode
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_OWNER_ID=your_numeric_chat_id
```

### Ollama notes

When you choose Ollama during `setup`, RifeClaw can:
- detect installed local models,
- estimate system RAM and suggest a fitting model,
- let you pick a known model or enter any model tag,
- optionally run `ollama pull <model>`.

## Commands

```bash
rifeclaw
rifeclaw wakeup
rifeclaw setup
rifeclaw doctor
```

- `rifeclaw` (no subcommand): starts wakeup picker.
- `wakeup`: explicitly open the same wakeup picker.
- `setup`: guided `.env` creation/update.
- `doctor`: readiness checks for provider and optional integrations.

All commands support:

```bash
--project <path>
```

Use it when the target codebase is not the current directory.

## Modes

### Main picker

- **Command Line Interface (CLI)**
- **Telegram Assistant**
- **Exit**

### CLI sub-modes

- **Agent Mode**: proposes code/file/shell mutations and stages them for approval.
- **Plan Mode**: creates a stepwise plan, lets you select steps, then stages results for approval.
- **Ask Mode**: read-only questions about the codebase.

### Telegram mode (optional)

After configuring Telegram credentials, you can use:
- `/ask`
- `/plan`
- `/agent`
- `/help`
- `/start`

## Safety Model

RifeClaw is designed for controlled local automation:

- File and folder mutations are **staged first**.
- Shell actions are **queued/staged first**.
- You must explicitly approve staged actions before they are applied.
- High-risk destructive shell patterns are blocked (for example force-delete patterns and dangerous git cleanup/reset operations).
- Shell execution is time-limited.

## Verification & Troubleshooting

### Verify setup

```bash
rifeclaw doctor
```

If not ready, follow the printed hints and re-run `rifeclaw setup`.

### Common checks

- **Missing `.env` or keys**: run `rifeclaw setup` again.
- **Ollama issues**: ensure Ollama is running and model/base URL are correct.
- **Telegram not responding**:
  - verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID`,
  - confirm you are messaging the configured owner account.
- **Working on another repository**: pass `--project <path>`.

## Development

For local development of this tool:

```bash
bun install
bun run setup
bun run doctor
bun run dev
```

Useful validation commands:

```bash
bun run test
bun run typecheck
bun run build
```

Test the installable command from this source checkout:

```bash
npm link
rifeclaw doctor --project .
```

Inspect package contents before publishing:

```bash
npm pack --dry-run
```

## Example App

A small browser-only demo lives in `todo-list-app/`.

Open `todo-list-app/index.html` in your browser to try it.

## Contributing

Issues and pull requests are welcome.

For best results before opening a PR:
- run `bun run test`
- run `bun run typecheck`
- run `bun run build`
- verify setup behavior with `bun run setup` and `bun run doctor`
