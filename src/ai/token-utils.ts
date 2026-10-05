/**
 * Token utilities for estimating token usage and managing context limits
 */

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  fitsInContext: boolean;
  availableTokens: number;
}

/**
 * Rough token estimation: 3 characters ≈ 1 token (matches memory.ts approximation)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Estimate tokens for a plan generation request
 * @param prompt The base prompt to send to the model
 * @param expectedSteps Estimated number of steps in the plan
 * @param contextLength Length of conversation context already loaded
 * @param maxContextTokens Maximum tokens allowed in context (default 8000)
 * @returns TokenEstimate with details about fit and availability
 */
export function estimatePlanTokens(
  prompt: string,
  expectedSteps: number,
  contextLength: number,
  maxContextTokens: number = 8000
): TokenEstimate {
  // Estimate tokens for the prompt itself
  const promptTokens = estimateTokens(prompt);

  // Estimate tokens for the expected JSON response
  // Base JSON overhead + per step
  const baseJsonOverhead = 50; // Opening/closing braces, field names, etc.
  const perStepEstimate = 150; // Average tokens per step (title, description, hints, complexity)
  const expectedOutputTokens = baseJsonOverhead + (expectedSteps * perStepEstimate);

  // Total tokens needed
  const totalTokens = promptTokens + contextLength + expectedOutputTokens;

  // Check if it fits in context
  const fitsInContext = totalTokens <= maxContextTokens;
  const availableTokens = Math.max(0, maxContextTokens - totalTokens);

  return {
    inputTokens: promptTokens + contextLength,
    outputTokens: expectedOutputTokens,
    totalTokens,
    fitsInContext,
    availableTokens
  };
}

/**
 * Adjust plan complexity based on available tokens
 * @param steps Array of plan steps
 * @param availableTokens Tokens available for the plan
 * @returns Adjusted steps array
 */
export function adjustPlanForTokenLimit(
  steps: Array<{ title: string; description: string; hints?: string[]; complexity?: 'low' | 'medium' | 'high' }>,
  availableTokens: number
): Array<{ title: string; description: string; hints?: string[]; complexity?: 'low' | 'medium' | 'high' }> {
  if (availableTokens > 500) { // Plenty of tokens available
    return steps;
  }

  // Reduce complexity or number of steps if tokens are limited
  const adjustedSteps = [...steps];

  // If very few tokens available, reduce to essential steps only
  if (availableTokens < 100) {
    return adjustedSteps.slice(0, Math.min(3, adjustedSteps.length));
  }

  // If moderately limited, simplify hints and descriptions
  if (availableTokens < 300) {
    return adjustedSteps.map(step => ({
      ...step,
      hints: step.hints?.slice(0, 1), // Keep at most 1 hint
      description: step.description.length > 100
        ? step.description.substring(0, 100) + '...'
        : step.description
    }));
  }

  return adjustedSteps;
}

/**
 * Generate a token-aware plan prompt that includes token budget guidance
 * @param basePrompt The original prompt
 * @param tokenEstimate The token estimate for the request
 * @returns Enhanced prompt with token guidance
 */
export function createTokenAwarePrompt(
  basePrompt: string,
  tokenEstimate: TokenEstimate
): string {
  if (!tokenEstimate.fitsInContext) {
    return [
      basePrompt,
      '',
      `⚠️  TOKEN LIMIT WARNING: Estimated token usage (${tokenEstimate.totalTokens}) exceeds context limit (${tokenEstimate.inputTokens + tokenEstimate.outputTokens + Math.abs(tokenEstimate.availableTokens)}).`,
      `Please provide a more concise goal or reduce conversation history.`,
      `Available tokens for plan: ${tokenEstimate.availableTokens}`
    ].join('\n');
  }

  if (tokenEstimate.availableTokens < 500) {
    return [
      basePrompt,
      '',
      `💡 TOKEN MANAGEMENT: Using ${tokenEstimate.inputTokens} input tokens,`,
      `${tokenEstimate.outputTokens} expected output tokens.`,
      `Available buffer: ${tokenEstimate.availableTokens} tokens.`,
      `Consider keeping the plan concise if the goal is complex.`
    ].join('\n');
  }

  return basePrompt;
}