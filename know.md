# RifeClaw Codebase Guide

This document is a navigable inventory of the files in this project and the functions they provide. It describes the source layout and the role of each function as implemented in the current tree. Dependency folders (`node_modules/`), generated output (`dist/`), logs, archives, and secret `.env` files are excluded.

## Project flow

`index.ts` selects a project directory, loads its environment, and routes the CLI command. `modes/cli.ts` selects Ask, Plan, or Agent mode. Those modes use `ToolExecutor` and the AI provider in `ai/ai.config.ts`; Agent and Plan stage code changes and request approval before applying them. Telegram uses the parallel workflow in `modes/telegram/`.

## Root files

| File | Purpose and functions |
|---|---|
| `index.ts` | CLI entry point. `prepareProject()` resolves and stores the target project and loads its environment; `selectedProject()` chooses between command-level and global project arguments; `main()` registers commands/options and dispatches setup, doctor, or interactive modes. |
| `project.ts` | Holds the selected workspace path. `resolveProjectPath()` validates and resolves a directory; `setProjectPath()` and `getProjectPath()` change/read the active root; `loadProjectEnv()` loads key/value settings from that project's `.env` without replacing already-set process variables. |
| `env.ts` | Typed environment access. `isMissingEnvError()` identifies missing-setting errors; `printMissingEnvHelp()` prints setup guidance; `requireEnv()` gets a required value; `optionalEnv()` gets an optional value; `getEnv()` provides generic fallback access; `getEnvInt()` and `getEnvBool()` parse numbers and booleans with defaults. |
| `setup.ts` | Interactive configuration wizard. `readEnvFile()` and `envValue()` read existing settings; `required()` normalizes required values; `systemRamGb()` measures memory; `recommendedOllamaModel()` selects a model based on memory; `installedOllamaModels()` lists local models; `pullOllamaModel()` downloads a selected model; `promptOllamaModel()`, `promptSecret()`, and `promptOptionalSecret()` collect configuration; `envLines()` serializes settings; `runSetup()` orchestrates prompts and writes `.env`. |
| `doctor.ts` | Configuration diagnostics. `readEnvFile()`, `hasEnv()`, and `envValue()` inspect configuration; `status()` prints a check; `runDoctor()` reports which required/optional settings and integrations are ready. |
| `build.ts` | Build script that bundles the CLI entry point into `dist/` for npm distribution. No reusable exported functions. |
| `package.json` | Package metadata, executable mapping, dependencies, and scripts (`dev`, `start`, `setup`, `doctor`, `build`, `test`, `typecheck`, `prepack`). |
| `bun.lock` | Locked dependency versions for Bun. |
| `tsconfig.json` | TypeScript compiler configuration. |
| `.env.example` | Names and example values for provider, Ollama, web, memory, and Telegram configuration. |
| `.gitignore` | Excludes dependencies, build output, archives, logs, coverage, local environment files, caches, and IDE metadata. |
| `README.md` | User documentation: requirements, installation, setup, commands, modes, environment, safety model, and demo app. |
| `know.md` | This file: source-tree inventory and function reference. |
| `ask.md` | Existing notes describing the Agent-mode architecture. |
| `LICENSE` | MIT license terms. |

## `ai/` — model configuration and provider adaptation

| File | Functions and role |
|---|---|
| `ai/ai.config.ts` | `withModelCache()` adds response-cache middleware; `getAgentModel()` constructs the configured OpenRouter or Ollama model; `generateWithMemory()` sends a prompt with prior session context; `formatStructuredOutput()` adds confidence and timestamp metadata. `StructuredOutput` describes the result shape. |
| `ai/ollama-tool-adapter.ts` | `OllamaToolAdapter` implements the AI SDK model interface over Ollama's local chat API. Its `doGenerate()` handles non-streaming requests and `doStream()` adapts streaming responses/tool calls. `createOllamaNativeAdapter()` constructs it. Helpers `flattenTextParts()`, `stripJsonFence()`, `parseJsonObject()`, `toolInputToObject()`, `normalizeToolArguments()`, and `toOllamaToolArguments()` normalize model/tool JSON; `extractToolCallsFromContent()` and `getToolCalls()` recover tool calls from Ollama responses; `convertPrompt()` and `convertTools()` translate AI SDK inputs; `makeUsage()` and `makeFinishReason()` normalize response metadata; `generateToolCallId()` creates IDs; `warnings()` returns compatibility warnings; `isCudaInitializationError()` identifies a known local-model startup error. |
| `ai/index.ts` | AI module barrel/re-exports. |
| `ai/ollama-tool-adapter.test.ts` | `callOptions()` builds mocked model-call inputs. Tests exercise Ollama adapter request conversion, text/tool-call parsing, stream output, finish reasons, usage, and error behavior. |

## `modes/agent/` — interactive coding workflow

| File | Functions and role |
|---|---|
| `types.ts` | Defines action/config types. `defaultAgentConfig()` sets workspace root, file-size limit, excluded paths, tool permissions, and token limit; `isMutationType()` identifies actions that change files or execute commands. |
| `action-tracker.ts` | `ActionTracker` records actions (`log()`), returns all actions or pending mutations (`getActions()`, `getPendingMutations()`), and changes an action's status (`updateStatus()`). |
| `tool-executor.ts` | `ToolExecutor` implements workspace tools and staged actions. `isProbablyTextFile()` filters readable files; `assertSafeShellCommand()` blocks empty, multiline, and selected destructive commands. Methods: `getEffectiveText()` reads the staged view; `readFile()`/`readFiles()` inspect files; `createFile()`/`modifyFile()`/`deleteFile()`/`createFolder()` stage filesystem changes; `listFiles()`/`searchFiles()`/`analyzeCodebase()` inspect structure and content; `queueShell()` stages an approved shell command; `skillRoots()`/`listSkills()`/`readSkill()` discover and read skills; `applyApprovedFromTracker()` applies approved actions; `clearStaging()` discards staged state. Path resolution and exclusion checks keep operations within the workspace and omit secret/build/dependency paths. |
| `agent-tools.ts` | `createAgentTools()` exposes executor operations as schema-validated model tools and optionally reports tool start/results through `AgentToolObserver`. |
| `orchestrator.ts` | `runAgentMode()` gathers a task, loads memory, runs the tool-using model loop, streams the response, then presents staged changes for approval or rejection. |
| `diff-view.ts` | `calculateRiskLevel()` estimates change risk; `getDiffStats()` counts patch changes; `colorizeDiff()` colors a patch for terminal display; `generateDiffResult()` creates review data; `formatPatch()` formats before/after text as a patch; `composeBeforeAfter()` merges action history into file comparisons. `RiskLevel`, `DiffResult`, and `DiffStats` describe review data. |
| `approval.ts` | Formats the review prompt. `riskIcon()` and `formatRisk()` render risk labels; `groupPending()` groups actions; `printSummary()` prints the overview; `displayDiff()` and `displayShell()` show details; `runApprovalFlow()` collects user approval decisions. |
| `tool-executor.test.ts` | `testConfig()` creates an isolated executor configuration. Tests cover workspace path/secret exclusions, staged writes, permission checks, blocked shell commands, and approved shell execution. |
| `diff-view.test.ts` | `action()` makes sample action logs. Tests cover risk estimation, diff formatting/statistics, and before/after composition. |

## `modes/plan/` — planning and selected-step execution

| File | Functions and role |
|---|---|
| `types.ts` | `PlanStep` and `Plan` define structured plans, steps, estimates, and dependencies. |
| `planner.ts` | `readOnlyTools()` gives the planning model read-only workspace tools; `generatePlan()` asks the model for a structured plan and validates/normalizes it. |
| `selection.ts` | `stepHint()` formats a short step description; `printPlan()` displays a plan; `selectSteps()` lets the user choose steps to run. |
| `orchestrator.ts` | `stepPrompt()` forms the task for one step; `executePlanSteps()` runs selected steps with progress and approval handling; `runPlanMode()` coordinates plan generation, selection, execution, and result reporting. `PlanExecutionResult` records the outcome. |
| `persistence.ts` | `formatStepMarkdown()` formats one step; `planToMarkdown()` serializes a plan; `defaultPlanFilename()` creates a timestamped name; `persistPlan()` saves the plan under the project plans directory. |
| `web-tools.ts` | `resetUsageIfNeeded()`, `recordUsage()`, and `getUsageStats()` track per-window web calls; `getClient()` initializes Firecrawl; `rateLimit()` waits as needed; `hasWebTools()` checks configuration; `clip()` bounds returned text; `createWebTools()` exposes web search/crawl/fetch tools to the model. |
| `orchestrator.test.ts` | `makeStreamAgent()` creates a fake streaming agent. Tests verify selected-step execution, rejected approval behavior, and failures. |
| `web-tools.test.ts` | Tests web-tool availability, input/output handling, usage/rate-limit behavior, and error paths using controlled dependencies. |

## `modes/ask/` — read-only Q&A

| File | Functions and role |
|---|---|
| `orchestrator.ts` | `createHelpExecutor()` and `matchCommand()` handle simple recognized help requests; `previewToolResult()` shortens progress output; `createAskTools()` exposes read-only codebase tools; `asMd()` formats saved answers; `defaultAskFilename()` creates a filename; `validateAskFilename()` validates an optional save name; `runAskMode()` runs read-only Q&A and optionally saves the answer. |
| `orchestrator.test.ts` | Tests recognized commands, read-only tool usage, response saving, filename validation, and cleanup behavior. |

## `modes/telegram/` — remote Telegram interface

| File | Functions and role |
|---|---|
| `index.ts` | `getErrorCode()`/`getErrorMessage()` normalize errors; `redactTelegramToken()` and `getSafeErrorDetails()` prevent token leakage; `isRetryableTelegramError()` classifies connection errors; `wait()` provides reconnect delay; `runTelegramMode()` starts the bot and retries transient connection failures. |
| `handlers.ts` | `escapeHtml()` safely formats HTML; `registerHandlers()` registers bot commands, authorization, run/cancel controls, and approval callbacks. |
| `auth.ts` | `isOwner()` checks a Telegram user ID against `TELEGRAM_OWNER_ID`. |
| `agent-run.ts` | Helper functions format status (`showLoading()`, `formatToolName()`, `formatToolResult()`, `showToolDone()`, `nowStamp()`, `done()`, `doneWithSummary()`, `partialDone()`), detect/format directory questions (`isDirectoryStructureQuestion()`, `normalizeWorkspacePath()`, `formatDirectoryStructure()`), configure model tools (`readOnlyConfig()`, `agentOptions()`, `createReadOnlyTools()`, `extraWebTools()`), and implement Telegram workflows (`runAsk()`, `runAgent()`, `runPlanSteps()`). `sendWelcome()` sends onboarding; `formatError()` maps errors to user-facing text; `progressBar()` formats progress. `WELCOME_MESSAGE` is the default greeting. |
| `approval-session.ts` | `groupPending()` separates pending changes; `approvalSummary()` summarizes them; `approvalDiff()` formats the diff; `promptApproval()` presents inline approval controls; `finishOrApprove()` completes the workflow or stores an approval session. `ApprovalSession` and `approvalSessions` hold pending approvals by chat. |
| `plan-session.ts` | `shortLabel()` clips step labels; `planMessage()` renders a plan; `planKeyboard()` builds plan selection controls; `refreshPlanUi()` edits the Telegram plan message after selection. `PlanSession` and `planSessions` store in-progress plans. |
| `text.ts` | Shared Telegram/terminal formatting. `ensureMarked()` initializes Markdown rendering; `renderTerminalMarkdown()` renders Markdown; `clip()` truncates text; `commandArg()` parses a slash-command argument; `isSimpleGreeting()` detects greetings; `wrapText()` wraps text; `renderCard()`/`renderHeader()` build layouts; `success()`, `error()`, `warning()`, `info()`, and `prompt()` add message styling; `codeBlock()`, `bulletList()`, `numberedList()`, `colorizeItem()`, and `summaryBox()` format content; `escapeMarkdown()` escapes Telegram Markdown; `replyMarkdown()` splits and sends formatted replies; `splitTelegramText()` respects message limits; `stripAnsi()` removes terminal escape sequences. `CardOptions` describes card layout. |
| `help.ts` | `md2()`, `bold()`, and `code()` build Telegram MarkdownV2 fragments; `buildHelpMessage()`, `buildWelcomeMessage()`, and `buildUnauthorizedMessage()` create bot messages; `welcomeKeyboard()` builds the onboarding keyboard. |
| `error.ts` | `escapeMd2()` escapes MarkdownV2; `usageError()`, `authorizationError()`, `internalError()`, `networkError()`, and `rateLimitError()` create Telegram-safe error messages. `TelegramErrorOptions` types usage guidance. |
| `provider-error.ts` | `collectErrorText()` safely extracts nested provider error details while limiting recursion; `telegramProviderError()` converts them to concise Telegram guidance. |
| `constants.ts` | Exports the static `WELCOME` text. |
| `approval-session.test.ts` | `action()` constructs a sample action. Tests cover approval summaries/diffs and session completion behavior. |
| `plan-session.test.ts` | `callbackData()` extracts button callback values; `session()` builds a test plan session. Tests cover plan text and selection keyboard generation. |
| `text.test.ts` | Tests command parsing, greeting detection, escaping, formatting, ANSI cleanup, and message splitting. |

## `src/` — shared infrastructure

| File | Functions and role |
|---|---|
| `src/ai/cache.ts` | `LLMResponseCache` stores generated responses with expiry/size controls. Methods: constructor initializes options; `get()` looks up a valid entry; `set()` stores one; `clear()` removes entries; `prune()` removes expired/old entries; `getStats()` returns cache metrics; `configure()` updates limits. Singleton/helper API: `getCachedResponse()`, `cacheResponse()`, `getCacheKey()`, `getCacheStats()`, `clearCache()`, `pruneCache()`, and `configureCache()`. `CacheEntry` and `CacheStats` define stored data/statistics. |
| `src/ai/cache.test.ts` | Tests cache keying, expiration, capacity, stats, clearing, and singleton helper functions. |
| `src/ai/model-cache-middleware.ts` | `makeCachePrompt()` makes a stable prompt key; `hasToolCall()` detects tool responses that should not be cached; `replayStream()` reconstructs a stream from cached parts. `modelCacheMiddleware` wraps model generation/streaming with cache behavior while bypassing tool calls. |
| `src/ai/memory.ts` | `contextTokenLimit()` reads the memory-context limit. `MemoryManager` methods: `projectSessionId()` scopes sessions to project/mode; `resolveSessionId()` reuses or creates IDs; `addMessage()` stores conversation messages; `getMessages()` returns recent turns; `getRecentContext()` creates token-limited context; `clearSession()` removes a session; `createTask()`/`updateTask()`/`getTask()`/`completeTask()` manage task state; `getRecentTasks()` lists recent work; `saveToDisk()`/`loadFromDisk()` persist data. `memoryManager` is the shared instance. |
| `src/ai/token-utils.ts` | `estimateTokens()` approximates prompt size; `estimatePlanTokens()` estimates plan size; `adjustPlanForTokenLimit()` reduces detail to fit; `createTokenAwarePrompt()` builds a prompt within a token budget. `TokenEstimate` describes estimate output. |
| `src/api/openrouter-client.ts` | `OpenRouterError` represents provider failures; `OpenRouterClient` wraps the provider. `getCompletion()` constructs a chat request; `createChatCompletion()` performs a non-streaming request and maps provider errors; `streamChatCompletion()` yields streamed text chunks; `getUsageStats()` returns request usage. `openRouterClient` is the shared client. Message, options, and response interfaces describe API payloads. |
| `src/errors/error-system.ts` | `ErrorCode` enumerates stable error categories. `RifeClawError` carries a code/context and provides `toDisplayString()`, `is()`, and `canRecover()`. `ConfigurationError`, `FileSystemError`, `OperationError`, `AIError`, `NetworkError`, and `MemoryError` specialize it. `ErrorHandler.handleError()` normalizes/logs errors and decides whether processing can continue; private `convertToClawError()` maps generic errors; `wrapPromise()` converts promise outcomes; `retryWithBackoff()` retries selected failures. `safeExecute()` wraps synchronous operations in consistent error handling. |
| `src/errors/error-system.test.ts` | Tests error classification, typed error data, and safe execution behavior. |
| `src/utils/api-usage-tracker.ts` | `ApiUsageTracker` tracks daily API calls and limits. `initFromEnv()` loads limits/Telegram alert settings; private `getDateKey()` gets today's key; `incrementUsage()` records and persists a call; `incrementLimitedCall()` counts a limited/error call; `getCurrentUsage()`, `getUsageHistory()`, and `getLimitedCalls()` read counters; private `checkLimits()` and `sendAlert()` detect thresholds and notify; private `loadHistory()`/`storeUsage()` persist state; `setDailyLimit()` sets a date limit; `getStats()` returns aggregate usage. `apiUsageTracker` is the shared instance. |
| `src/utils/live-token-usage.ts` | `createLiveTokenUsageReporter()` returns a callback that prints provider-reported input/output tokens after each model call and a cumulative task total. `TokenUsageSnapshot` and `TokenUsageReporter` define the callback data and type. |

## `tui/` — terminal presentation

| File | Functions and role |
|---|---|
| `tui/wakeup.ts` | `printBannerWithShadow()` draws the startup title; `runWakeup()` displays the startup/welcome screen. |
| `tui/terminal-md.ts` | `ensureMarked()` initializes Markdown terminal rendering; `renderTerminalMarkdown()` converts Markdown to terminal text; `wrapText()` wraps lines; `renderCard()` and `renderHeader()` create panels/headings; `success()`, `error()`, `warning()`, `info()`, and `prompt()` style status text; `codeBlock()`, `bulletList()`, `numberedList()`, `colorizeItem()`, and `summaryBox()` build common terminal output. `TERM_WIDTH` stores detected terminal width; `CardOptions` configures cards. |

## Other source and utility files

| File | Purpose and functions |
|---|---|
| `modes/cli.ts` | `runCliMode()` displays the interactive mode selector and dispatches the selected mode. |
| `env.test.ts` | Tests required/optional environment access, parsing, and missing-setting guidance. |
| `check-help.mjs` | `findUnescaped()` is a small validation helper for detecting unescaped characters in help text. |
| `check-all-sends.mjs` | `findUnescaped()` checks Telegram send paths/text for unescaped markup characters. |
| `trace-md2.mjs` | Standalone diagnostic copy of `md2()` used to trace MarkdownV2 escaping; not part of the application runtime. |

## Demo and planning folders

| File | Purpose and functions |
|---|---|
| `todo-list-app/index.html` | Browser demo page and markup; loads `styles.css` and `script.js`. |
| `todo-list-app/styles.css` | Visual styling for the browser todo demo. |
| `todo-list-app/script.js` | `loadTodos()` reads saved todos; `saveTodos()` persists them in browser storage; `renderTodos()` redraws the UI and connects user actions. |
| `todo-app/PLAN-data-storage.md` | Design note for a separate todo app. It documents proposed `loadTodos()`, `saveTodos()`, `getTodos()`, `addTodo()`, `toggleTodo()`, `editTodo()`, `deleteTodo()`, `clearCompleted()`, and `clearAll()` functions; these are examples in a plan, not RifeClaw runtime functions. |
| `plans/plan-2026-09-02T04-57-18Z.md` | Saved historical plan document. |
| `plans/plan-2026-09-02T05-06-21Z.md` | Saved historical plan document. |

## Function naming notes

- Test files also contain anonymous `test()`/`describe()` callbacks; their purpose is summarized with each test file above.
- `ai/ollama-tool-adapter.ts` contains adapter-internal generation and stream methods in addition to the named normalization helpers listed above.
- `src/errors/error-system.ts`, `src/api/openrouter-client.ts`, `src/ai/cache.ts`, and `src/utils/api-usage-tracker.ts` include class methods; their method groups are described above because the class methods form the public behavior of those modules.
- Revisit this guide when files or functions are added, renamed, or removed.
