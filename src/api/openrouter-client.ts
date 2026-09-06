import { apiUsageTracker } from '../utils/api-usage-tracker';

const OPENROUTER_API_BASE = process.env.OPENROUTER_API_BASE_URL || 'https://openrouter.ai/api/v1';

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenRouterCompletionOptions {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class OpenRouterClient {
  private apiKey: string;
  private defaultModel: string;

  constructor(modelName?: string) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';
    this.apiKey = apiKey;
    this.defaultModel = modelName || (process.env.OPENROUTER_DEFAULT_MODEL?.trim() || 'openai/gpt-4o-mini');

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }
  }

  async getCompletion(prompt: string, options?: Partial<OpenRouterCompletionOptions>): Promise<string> {
    const messages: OpenRouterMessage[] = [
      ...(options?.messages || []),
      { role: 'user', content: prompt }
    ];

    return this.createChatCompletion({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens,
      stream: options?.stream ?? false
    });
  }

  async createChatCompletion(options: OpenRouterCompletionOptions): Promise<string> {
    apiUsageTracker.incrementUsage();

    try {
      const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://github.com/rifeclaw',
          'X-Title': 'RifeClaw'
        },
        body: JSON.stringify(options)
      });

      if (!response.ok) {
        let errorDetails: unknown;
        try {
          errorDetails = await response.json();
        } catch {
          errorDetails = await response.text();
        }

        apiUsageTracker.incrementLimitedCall();

        if (response.status === 429) {
          const stats = apiUsageTracker.getStats();
          throw new OpenRouterError(
            429,
            `Daily API quota exceeded. Usage: ${stats.currentUsage}/${stats.dailyLimit}. Please wait for limit reset.`,
            errorDetails
          );
        }

        if (response.status === 401) {
          throw new OpenRouterError(
            401,
            'Invalid or missing API key. Check OPENROUTER_API_KEY in .env',
            errorDetails
          );
        }

        if (response.status === 402) {
          throw new OpenRouterError(
            402,
            'Insufficient credits. Add credits to your OpenRouter account.',
            errorDetails
          );
        }

        throw new OpenRouterError(
          response.status,
          `API Error: ${JSON.stringify(errorDetails)}`,
          errorDetails
        );
      }

      const data: OpenRouterResponse = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      if (error instanceof OpenRouterError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      apiUsageTracker.incrementLimitedCall();
      throw new Error(`OpenRouter API Error: ${message} (Usage: ${apiUsageTracker.getCurrentUsage()}/${apiUsageTracker.getStats().dailyLimit})`);
    }
  }

  async *streamChatCompletion(options: OpenRouterCompletionOptions): AsyncGenerator<string> {
    apiUsageTracker.incrementUsage();

    const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...options, stream: true })
    });

    if (!response.ok) {
      const error = await response.text();
      apiUsageTracker.incrementLimitedCall();
      throw new OpenRouterError(response.status, `Stream error: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  getUsageStats() {
    return apiUsageTracker.getStats();
  }
}

// Singleton instance
export const openRouterClient = new OpenRouterClient();