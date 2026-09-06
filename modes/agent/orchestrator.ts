import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel, formatStructuredOutput } from "../../ai/ai.config";
import { memoryManager } from "../../src/ai/memory";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";

export async function runAgentMode() {
  console.log(chalk.bold("\n🤖 Agent Mode\n"));
  console.log(chalk.cyan("🔍 Ready to receive a task. Type /back to return.\n"));

  const goal = await text({
    message: "What would you like the agent to do?",
    placeholder: "Concrete task for this codebase...",
  });

  if (isCancel(goal) || !goal.trim()) return;

  const trimmedGoal = goal.trim();
  if (trimmedGoal.toLowerCase() === "/back") return;

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
  const tools = createAgentTools(executor);

  console.log(chalk.cyan("⚡ Processing tool calls...\n"));

  // Build the effective prompt: prepend prior conversation context if available
  const priorMessages = memoryManager.getRecentContext(sessionId);
  const effectivePrompt = priorMessages
    ? `${priorMessages}\n\n---\n\nCurrent request:\n${trimmedGoal}`
    : trimmedGoal;

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: [
      `Workspace root: ${config.codebasePath}`,
      "All mutations are staged until approval.",
      priorMessages
        ? "You have a conversation history below. Consider previous requests and responses when answering."
        : "This is the start of a fresh conversation.",
      "Provide clear, structured responses with confidence levels.",
    ].filter(Boolean).join("\n"),
    tools,
  });

  const result = await agent.stream({
    prompt: effectivePrompt,
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls) {
        const preview = JSON.stringify(tc.input).slice(0, 160);
        console.log(chalk.green("  ✓"), chalk.bold(String(tc.toolName)), chalk.dim(preview + (preview.length >= 160 ? "..." : "")));
      }
    },
  });

  // Stream output line-by-line so the user sees the agent think in real time.
  // Buffer chunks and flush on each newline to avoid half-line updates.
  let buffer = "";
  let lineCount = 0;
  for await (const chunk of result.textStream) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      console.log(renderTerminalMarkdown(line));
      lineCount++;
    }
  }
  if (buffer.trim().length > 0) {
    console.log(renderTerminalMarkdown(buffer));
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

  console.log(chalk.cyan("🔧 Changes are ready for approval...\n"));

  const ok = await runApprovalFlow(tracker);
  if (!ok) {
    console.log(chalk.yellow("\n✋ Changes rejected. Nothing was applied.\n"));
    memoryManager.updateTask(taskId, { status: 'failed', result: 'Rejected by user' });
    return executor.clearStaging();
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
}