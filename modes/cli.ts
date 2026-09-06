import chalk from "chalk";
import { select, isCancel, confirm } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runAskMode } from "./ask/orchestrator";
import { runPlanMode } from "./plan/orchestrator";

/** Simple state to track if any sub-mode has produced unsaved output */
let hasUnsavedWork = false;

/** Call this from sub-modes when they produce output that hasn't been explicitly saved/confirmed */
export function markUnsavedWork() {
  hasUnsavedWork = true;
}

/** Call this when the user has explicitly saved/confirmed their work */
export function clearUnsavedWork() {
  hasUnsavedWork = false;
}

export async function runCliMode() {
  while (true) {
    const mode = await select({
      message: "Choose CLI sub-mode",
      options: [
        { value: "agent", label: "Agent Mode" },
        { value: "plan", label: "Plan Mode" },
        { value: "ask", label: "Ask Mode" },
        { value: "back", label: "<- Back to main menu" },
      ],
    });

    if (isCancel(mode)) {
      // User pressed Esc - just exit without confirmation
      return;
    }

    if (mode === "back") {
      // User explicitly chose "Back to main menu"
      if (hasUnsavedWork) {
        const confirmed = await confirm({
          message: "You have unsaved changes. Continue back to main menu?",
          initialValue: false,
        });
        if (!confirmed) {
          // User chose to stay - continue the loop
          continue;
        }
      }
      // Clear state and show visual cue
      clearUnsavedWork();
      console.log(chalk.dim("\n↩️  Returning to main menu...\n"));
      return;
    }

    // Reset unsaved work flag at the start of each sub-mode
    clearUnsavedWork();

    if (mode === "agent") {
      await runAgentMode();
    }
    if (mode === "ask") {
      await runAskMode();
    }
    if (mode === "plan") {
      await runPlanMode();
    }

    if (mode !== "agent" && mode !== "plan" && mode !== "ask") {
      console.log(chalk.yellow("\nThat mode is not implemented yet.\n"));
    }
  }
}
