import { isCancel, select, text } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel, formatStructuredOutput } from "../../ai/ai.config";
import { RifeClawError } from "../../src/errors/error-system.ts";
import { memoryManager } from "../../src/ai/memory";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";
import { createLiveTokenUsageReporter } from "../../src/utils/live-token-usage.ts";
import { createReasoningDropdown } from "../../tui/reasoning-dropdown";

export async function runAgentMode(): Promise<boolean> {
  console.log(chalk.bold("\n🤖 Agent Mode\n"));
  console.log(chalk.cyan("🔍 Ready to receive a task. Type /back to return.\n"));

  const goal = await text({
    message: "What would you like the agent to do?",
    placeholder: "Concrete task for this codebase...",
  });

  if (isCancel(goal) || !goal.trim()) return true;

  const trimmedGoal = goal.trim();
  if (trimmedGoal.toLowerCase() === "/back") return false;

  // Load memory from disk so we have access to previous sessions
  memoryManager.loadFromDisk();

  // Use a stable session ID for this mode + project so conversation history
  // accumulates across invocations. e.g. "agent_abcd1234"
  const config = defaultAgentConfig();
  const sessionId = memoryManager.resolveSessionId('agent', config.codebasePath);

  // Show how much prior context we'll be carrying in
  const priorContext = memoryManager.getRecentContext(sessionId);
  if (priorContext) {
    const turns = memoryManager.getMessages(sessionId, 50).length;
    console.log(chalk.dim(`\n💾 Loaded ${turns} prior message${turns !== 1 ? 's' : ''} from this project\n`));
  }

  const taskId = memoryManager.createTask(trimmedGoal);

  // Record user message in memory
  memoryManager.addMessage(sessionId, 'user', trimmedGoal);

  console.log(chalk.cyan("\n🤖 Agent is analyzing your request..."));
  console.log(chalk.dim("   (reading files, planning changes)\n"));

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const preview = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return (text ?? "").replace(/\s+/g, " ").slice(0, 140);
  };
  const tools = createAgentTools(executor, {
    onToolStart: (name, input) => console.log(chalk.yellow("  →"), chalk.bold(name), chalk.dim(preview(input))),
    onToolFinish: (name, result) => console.log(chalk.green("  ✓"), chalk.bold(name), chalk.dim(preview(result))),
  });

  // Build the effective prompt: prepend prior conversation context if available
  const effectivePrompt = priorContext
    ? `${priorContext}\n\n---\n\nCurrent request:\n${trimmedGoal}`
    : trimmedGoal;

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: [
      `Workspace root: ${config.codebasePath}`,
      "All mutations are staged until approval.",
      priorContext
        ? "You have a conversation history below. Consider previous requests and responses when answering."
        : "This is the start of a fresh conversation.",
      "Provide clear, structured responses with confidence levels.",
    ].filter(Boolean).join("\n"),
    tools,
  });

  const reportTokenUsage = createLiveTokenUsageReporter();
  const result = await agent.stream({
    prompt: effectivePrompt,
    onStepFinish: ({ usage }) => reportTokenUsage(usage),
  });

  // Capture reasoning separately from text output
  const reasoningDropdown = createReasoningDropdown();

  // Render complete Markdown blocks from the full stream.
  // Separate text-delta parts (rendered as markdown) from reasoning-delta parts
  // (accumulated for the reasoning dropdown).
  let textBuffer = "";
  let lineCount = 0;
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      textBuffer += part.text;
      let boundary = textBuffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = textBuffer.slice(0, boundary);
        if (((block.match(/```/g) ?? []).length % 2) === 1) {
          const next = textBuffer.indexOf("\n\n", boundary + 2);
          if (next < 0) break;
          boundary = next;
          continue;
        }
        if (block.trim()) {
          console.log(renderTerminalMarkdown(block));
          lineCount++;
        }
        textBuffer = textBuffer.slice(boundary + 2);
        boundary = textBuffer.indexOf("\n\n");
      }
    } else if (part.type === "reasoning-delta") {
      reasoningDropdown.append(part.text);
    }
  }
  // Flush any remaining buffered text
  if (textBuffer.trim().length > 0) {
    console.log(renderTerminalMarkdown(textBuffer));
    lineCount++;
  }

  const fullText = await result.text;

  // Record assistant response in memory
  memoryManager.addMessage(sessionId, 'assistant', fullText);

  if (fullText.trim() && lineCount === 0) {
    // Stream produced no printable lines (e.g. only whitespace) — show fallback
    console.log(chalk.green("\n✅ Agent output generated:\n"));
    const formatted = formatStructuredOutput({ answer: fullText }, 0.95);
    console.log(renderTerminalMarkdown(formatted.data.answer), "\n");
  }

  // Always show the panel control so users can tell whether reasoning arrived.
  let collapsed = true;
  if (reasoningDropdown.hasContent()) {
    console.log("\n" + reasoningDropdown.render());
  } else {
    console.log(chalk.dim("\nNo reasoning tokens were returned for this response."));
  }

  while (true) {
    const hasReasoning = reasoningDropdown.hasContent();
    const action = await select({
      message: "Internal reasoning (use ↑/↓ and Enter)",
      options: [
        ...(hasReasoning
          ? [{ value: "toggle", label: collapsed ? "Show reasoning" : "Hide reasoning" }]
          : [{ value: "info", label: "Why is no reasoning shown?" }]),
        { value: "continue", label: "Continue" },
      ],
    });
    if (isCancel(action) || action === "continue") break;
    if (hasReasoning) {
      reasoningDropdown.toggle();
      collapsed = !collapsed;
      console.log("\n" + reasoningDropdown.render());
    } else {
      console.log(chalk.dim(
        "No reasoning was emitted. Enable OPENROUTER_REASONING_ENABLED and use an OpenRouter model that supports reasoning.\n",
      ));
    }
  }

  if (tracker.getPendingMutations().length === 0) {
    console.log(chalk.green("\n✅ Task complete. No file changes were needed.\n"));
    memoryManager.updateTask(taskId, { status: 'completed', result: 'Completed without file changes' });
    memoryManager.saveToDisk();
    executor.clearStaging();
    return true;
  }

  console.log(chalk.cyan("🔧 Changes are staged. Review them before applying.\n"));

  const ok = await runApprovalFlow(tracker);
  if (!ok) {
    console.log(chalk.yellow("\n✋ Changes rejected. Nothing was applied.\n"));
    memoryManager.updateTask(taskId, { status: 'failed', result: 'Rejected by user' });
    memoryManager.saveToDisk();
    executor.clearStaging();
    return true;
  }

  const { errors } = executor.applyApprovedFromTracker();

  if (errors.length) {
    console.log(chalk.red("\n⚠️ Some operations reported errors:\n"));
    for (const e of errors) console.log(chalk.red(`  ❌ ${e}`));
    memoryManager.updateTask(taskId, { status: 'failed', result: errors.join('\n') });
  } else {
    console.log(chalk.green("\n✓ All changes applied successfully!\n"));
    memoryManager.updateTask(taskId, { status: 'completed', result: 'Changes applied' });
  }

  // Save memory to disk
  memoryManager.saveToDisk();

  executor.clearStaging();
  return true;
}
