import { describe, expect, test } from "bun:test";
import { executePlanSteps, stepPrompt } from "./orchestrator.ts";
import type { PlanStep } from "./types.ts";

const steps: PlanStep[] = [
  {
    id: "step-1",
    title: "Read files",
    description: "Inspect the project.",
    complexity: "low",
  },
  {
    id: "step-2",
    title: "Write fixes",
    description: "Patch the issues.",
    complexity: "medium",
  },
];

describe("stepPrompt", () => {
  test("includes the goal, step title, and description", () => {
    expect(stepPrompt("Improve app", steps[0]!)).toBe(
      "Goal: Improve app\nStep: Read files\nInspect the project.",
    );
  });
});

describe("executePlanSteps", () => {
  test("executes every selected step before approval", async () => {
    const prompts: string[] = [];
    const printed: string[] = [];
    let approvals = 0;
    let applies = 0;
    let clears = 0;

    await executePlanSteps("Improve app", steps, {
      createStepAgent: () => ({
        generate: async ({ prompt }) => {
          prompts.push(prompt);
          return { text: `done ${prompts.length}` };
        },
      }),
      approve: async () => {
        approvals++;
        return true;
      },
      applyApproved: () => {
        applies++;
        return { errors: [] };
      },
      clearStaging: () => {
        clears++;
      },
      print: (message) => printed.push(message),
      printError: (message) => printed.push(message),
      renderMarkdown: (source) => `rendered:${source}`,
    });

    expect(prompts).toEqual([
      stepPrompt("Improve app", steps[0]!),
      stepPrompt("Improve app", steps[1]!),
    ]);
    expect(approvals).toBe(1);
    expect(applies).toBe(1);
    expect(clears).toBe(1);
    expect(printed).toContain("rendered:done 1");
    expect(printed).toContain("rendered:done 2");
  });

  test("clears staging and skips apply when approval is rejected", async () => {
    let applies = 0;
    let clears = 0;

    await executePlanSteps("Improve app", [steps[0]!], {
      createStepAgent: () => ({
        generate: async () => ({ text: null }),
      }),
      approve: async () => false,
      applyApproved: () => {
        applies++;
        return { errors: [] };
      },
      clearStaging: () => {
        clears++;
      },
      print: () => {},
      printError: () => {},
      renderMarkdown: (source) => source,
    });

    expect(applies).toBe(0);
    expect(clears).toBe(1);
  });

  test("prints apply errors", async () => {
    const errors: string[] = [];

    await executePlanSteps("Improve app", [steps[0]!], {
      createStepAgent: () => ({
        generate: async () => ({ text: undefined }),
      }),
      approve: async () => true,
      applyApproved: () => ({ errors: ["failed write"] }),
      clearStaging: () => {},
      print: () => {},
      printError: (message) => errors.push(message),
      renderMarkdown: (source) => source,
    });

    expect(errors.join("\n")).toContain("failed write");
  });
});
