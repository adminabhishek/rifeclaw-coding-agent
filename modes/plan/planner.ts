import {
  NoObjectGeneratedError,
  Output,
  extractJsonMiddleware,
  generateText,
  stepCountIs,
  tool,
  wrapLanguageModel,
} from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { z } from "zod";
import chalk from "chalk";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import type { Plan, PlanStep } from "./types.ts";
import { createWebTools, hasWebTools } from "./web-tools.ts";

const planSchema = z.object({
  researchSummary: z.string().optional(),
  steps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        hints: z.array(z.string()).optional(),
        complexity: z.enum(["low", "medium", "high"]).optional(),
      }),
    )
    .min(1)
    .max(15),
});

function readOnlyTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}

const PLAN_INSTRUCTIONS = (codebase: string, hasWeb: boolean) =>
  [
    "You are a Plan-Mode planner. You DO NOT modify files.",
    `Workspace: ${codebase}`,
    "Use read-only tools for codebase/skills research.",
    hasWeb
      ? "Web tools are available (web_search/web_crawl/fetch_url). Use only when needed."
      : "Web tools are unavailable (no FIRECRAWL_API_KEY).",
    "",
    "CRITICAL: You must respond with ONLY valid JSON matching the schema.",
    "Do NOT include any explanatory text, markdown formatting, or code fences.",
    "Do NOT write prose, analysis, or commentary before or after the JSON.",
    "Your response must start with `{` and end with `}`.",
    "No prose. No markdown. Just raw JSON.",
    "",
    "Required JSON shape:",
    "{",
    '  "researchSummary": "optional brief summary string",',
    '  "steps": [',
    "    {",
    '      "title": "step title (string)",',
    '      "description": "step description (string)",',
    '      "hints": ["optional", "hints", "array"],',
    '      "complexity": "low" | "medium" | "high"',
    "    }",
    "  ]",
    "}",
    "",
    "Keep it short: 1–15 steps.",
  ].join("\n");

export async function generatePlan(goal: string, priorContext?: string) {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const hasWeb = hasWebTools();
  const model = wrapLanguageModel({
    model:getAgentModel() as LanguageModelV3,
    middleware:extractJsonMiddleware()
  })


  const tools = { ...readOnlyTools(executor) , ...(hasWeb ? createWebTools(tracker) : {}) };

  console.log(chalk.cyan("\n🔍 Researching & drafting a plan…\n"));

  const basePrompt = priorContext
    ? `Previous conversation in this project:\n${priorContext}\n\n---\n\nCurrent user goal:\n${goal}`
    : `User goal: \n${goal}`;

  let result;
  try {
    result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(20),
      system: PLAN_INSTRUCTIONS(config.codebasePath, hasWeb),
      prompt: basePrompt,
      output: Output.object({ schema: planSchema }),
    });
  } catch (firstError) {
    if (!NoObjectGeneratedError.isInstance(firstError)) throw firstError;

    // First attempt produced non-JSON. Retry once with a strict reminder.
    console.log(chalk.yellow("\n⚠️  Model returned non-JSON. Retrying with strict JSON reminder…\n"));

    const retrySystem = [
      PLAN_INSTRUCTIONS(config.codebasePath, hasWeb),
      "",
      "STRICT REMINDER: Your previous response was not valid JSON.",
      "Reply with ONLY the JSON object. No prose, no markdown, no code fences.",
      "The first character of your response must be `{` and the last must be `}`.",
    ].join("\n");

    try {
      result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(20),
        system: retrySystem,
        prompt: basePrompt,
        output: Output.object({ schema: planSchema }),
      });
    } catch {
      // Retry also failed. Fall back to a single-step plan.
      console.log(chalk.red("\n❌ Model failed to produce valid JSON after retry."));
      console.log(chalk.dim("   Returning a fallback single-step plan.\n"));

      return {
        goal,
        researchSummary: `Plan generation failed. Model may not support structured output.`,
        steps: [
          {
            id: "step-1",
            title: "Manual planning required",
            description: `The goal "${goal}" could not be auto-planned. Try rephrasing, or switch to Ask Mode for guidance first.`,
            complexity: "medium" as const,
          },
        ],
      };
    }
  }

  const validated = planSchema.parse(result.output);

  const steps:PlanStep[] = validated.steps.map((s , i)=>({
    id:`step-${i+1}`,
    title:s.title,
    description:s.description,
    hints:s.hints,
    complexity:s.complexity
  }));

  return {goal , researchSummary:validated.researchSummary , steps}
}
