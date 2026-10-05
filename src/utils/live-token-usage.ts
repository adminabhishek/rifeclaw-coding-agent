import chalk from "chalk";

export interface TokenUsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type TokenUsageReporter = (usage: TokenUsageSnapshot) => void;

/** Print provider-reported token usage after every completed model call. */
export function createLiveTokenUsageReporter(label = "Token usage"): TokenUsageReporter {
  let taskTotal = 0;

  return (usage) => {
    const input = usage.inputTokens;
    const output = usage.outputTokens;
    if (input === undefined && output === undefined && usage.totalTokens === undefined) return;

    const stepTotal = usage.totalTokens ?? (input ?? 0) + (output ?? 0);
    taskTotal += stepTotal;
    const details = [
      input === undefined ? undefined : `in ${input.toLocaleString()}`,
      output === undefined ? undefined : `out ${output.toLocaleString()}`,
    ].filter(Boolean).join(", ");

    console.log(chalk.dim(
      `\n${label}: +${stepTotal.toLocaleString()} this call${details ? ` (${details})` : ""} · ${taskTotal.toLocaleString()} task total`,
    ));
  };
}
