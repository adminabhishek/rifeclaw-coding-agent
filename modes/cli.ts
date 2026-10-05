import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runAskMode } from "./ask/orchestrator";
import { runPlanMode } from "./plan/orchestrator";
import { providerErrorMessage } from "../src/ai/provider-error.ts";

export async function runCliMode() {
  let currentMode: "agent" | "plan" | "ask" | undefined;

  while (true) {
    if (!currentMode) {
      const mode = await select({
        message: "Choose CLI sub-mode",
        options: [
          { value: "agent", label: "Agent Mode" },
          { value: "plan", label: "Plan Mode" },
          { value: "ask", label: "Ask Mode" },
          { value: "back", label: "<- Back to main menu" },
        ],
      });

      if (isCancel(mode)) return;

      if (mode === "back") {
        console.log(chalk.dim("\nReturning to main menu...\n"));
        return;
      }

      currentMode = mode;
    }

    try {
      if (currentMode === "agent") {
        if (!(await runAgentMode())) currentMode = undefined;
      } else if (currentMode === "ask") {
        await runAskMode();
        currentMode = undefined;
      } else if (currentMode === "plan") {
        if (!(await runPlanMode())) currentMode = undefined;
      }
    } catch (error) {
      console.log(chalk.red(`\n${providerErrorMessage(error)}\n`));
      currentMode = undefined;
    }
  }
}
