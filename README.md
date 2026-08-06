# RifeClaw

A Bun-powered TypeScript CLI for working with a codebase through local CLI modes
and an optional Telegram bot.

## Requirements

- Bun
- OpenRouter API key
- Optional: Firecrawl API key for web search/crawl tools
- Optional: Telegram bot token and owner chat ID for Telegram mode

## Quick Start

Install RifeClaw in the project you want to work on:

```bash
npm install --save-dev rifeclaw
npx rifeclaw setup
npx rifeclaw doctor
npx rifeclaw
```

Or install it globally once and run it from inside any project:

```bash
npm install -g rifeclaw
cd my-project
rifeclaw setup
rifeclaw doctor
rifeclaw
```

Or point the tool at a project from anywhere:

```bash
rifeclaw --project ../my-project setup
rifeclaw --project ../my-project doctor
rifeclaw --project ../my-project
```

In both cases, Ask, Plan, Agent, and Telegram mode operate on `my-project`.

`setup` creates or updates `.env` with guided prompts. `doctor` checks whether
the project is ready before the user starts a mode.

## Development

For local development of this tool:

```bash
bun install
bun run setup
bun run doctor
bun run dev
```

To test the installable command from this source checkout:

```bash
npm link
rifeclaw doctor --project .
```

To inspect the exact npm package contents before publishing:

```bash
npm pack --dry-run
```

## Environment

The easiest option is:

```bash
rifeclaw setup
```

You can also copy `.env.example` to `.env` and fill in the values manually:

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1

# Optional web tools
FIRECRAWL_API_KEY=your_firecrawl_key

# Optional Telegram mode
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_OWNER_ID=your_numeric_chat_id
```

## Commands

```bash
rifeclaw setup
rifeclaw doctor
rifeclaw
```

- `setup`: guided `.env` creation for required and optional integrations.
- `doctor`: setup health check with clear next steps.
- Running `rifeclaw` with no subcommand starts the interactive mode picker.

All commands accept `--project <path>` when the target codebase is not the
current directory.

## Modes

- `Agent Mode`: lets the agent inspect and stage code changes for approval.
- `Plan Mode`: generates a plan, lets you choose steps, then stages changes for approval.
- `Ask Mode`: answers questions about the codebase without modifying files.
- `Telegram`: exposes ask, agent, and plan workflows through a Telegram bot.

## Safety Model

File, folder, and shell mutations are staged first. The CLI shows an approval
flow before applying them. Shell execution is additionally blocked for several
high-risk destructive commands and has a timeout.

## Example App

`todo-list-app` is a small browser-only todo demo. Open
`todo-list-app/index.html` in a browser to try it.
