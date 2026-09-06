#!/usr/bin/env node

import { Command } from "commander";
import { runWakeup } from "./tui/wakeup";
import { runDoctor } from "./doctor";
import { runSetup } from "./setup";
import { isMissingEnvError, printMissingEnvHelp } from "./env.ts";
import { loadProjectEnv, resolveProjectPath, setProjectPath } from "./project.ts";

const program = new Command();

function prepareProject(project?: string): string {
  const root = resolveProjectPath(project);
  setProjectPath(root);
  loadProjectEnv(root);
  return root;
}

function selectedProject(commandProject?: string): string {
  return commandProject || program.opts().project;
}

program
  .name("rifeclaw")
  .description("RifeClaw AI coding assistant")
  .version("0.1.6")
  .option("-p, --project <path>", "Project directory to inspect or modify", ".");

program.action(async () => {
  prepareProject(program.opts().project);
  await runWakeup();
});

program
  .command("wakeup")
  .description("Show the banner and pick cli or telegram mode")
  .option("-p, --project <path>", "Project directory to inspect or modify")
  .action(async (options) => {
    prepareProject(selectedProject(options.project));
    await runWakeup();
  });

program
  .command("setup")
  .description("Create or update .env with guided prompts")
  .option("-p, --project <path>", "Project directory to configure")
  .action(async (options) => {
    const root = prepareProject(selectedProject(options.project));
    await runSetup(root);
  });

program
  .command("doctor")
  .description("Check whether local setup is ready")
  .option("-p, --project <path>", "Project directory to check")
  .action((options) => {
    const root = prepareProject(selectedProject(options.project));
    runDoctor(root);
  });

// Wrap in an async main() to avoid top-level await — which is unreliable
// when the bundled output is invoked through npm's shim. Using main() also
// gives us a proper place to handle the missing-env case before any prompts
// are shown.
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (isMissingEnvError(error)) {
      printMissingEnvHelp(error);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

main();
