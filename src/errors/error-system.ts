// Centralized error handling system for RifeClaw

export enum ErrorCode {
  // Configuration Errors
  MISSING_ENV_VAR = 'ERR_CFG_001',
  INVALID_ENV_VALUE = 'ERR_CFG_002',
  CONFIG_LOAD_FAILED = 'ERR_CFG_003',

  // File System Errors
  FILE_NOT_FOUND = 'ERR_FS_001',
  FILE_TOO_LARGE = 'ERR_FS_002',
  PATH_ESCAPE = 'ERR_FS_003',
  PERMISSION_DENIED = 'ERR_FS_004',
  FILE_ALREADY_EXISTS = 'ERR_FS_005',
  FOLDER_CREATION_FAILED = 'ERR_FS_006',
  FILE_TOO_LARGE_TO_READ = 'ERR_FS_007',
  DIRECTORY_NOT_FOUND = 'ERR_FS_008',

  // Operation Errors
  OPERATION_DISABLED = 'ERR_OP_001',
  INVALID_OPERATION = 'ERR_OP_002',
  SHELL_COMMAND_REQUIRED = 'ERR_OP_003',
  MULTILINE_COMMAND_BLOCKED = 'ERR_OP_004',
  SHELL_COMMAND_BLOCKED = 'ERR_OP_005',
  SHELL_EXECUTION_FAILED = 'ERR_OP_006',
  SHELL_TIMEOUT = 'ERR_OP_007',

  // AI/LLM Errors
  AI_PROVIDER_NOT_CONFIGURED = 'ERR_AI_001',
  AI_API_ERROR = 'ERR_AI_002',
  AI_MODEL_NOT_CONFIGURED = 'ERR_AI_003',
  AI_RATE_LIMITED = 'ERR_AI_004',
  AI_QUOTA_EXCEEDED = 'ERR_AI_005',
  AI_NETWORK_ERROR = 'ERR_AI_006',

  // Memory/Storage Errors
  MEMORY_LOAD_FAILED = 'ERR_MEM_001',
  MEMORY_SAVE_FAILED = 'ERR_MEM_002',
  MEMORY_CORRUPTED = 'ERR_MEM_003',

  // Network Errors
  NETWORK_ERROR = 'ERR_NET_001',
  NETWORK_TIMEOUT = 'ERR_NET_002',
  API_RATE_LIMITED = 'ERR_NET_003',
  SERVICE_UNAVAILABLE = 'ERR_NET_004',

  // Validation Errors
  INVALID_INPUT = 'ERR_VAL_001',
  VALIDATION_FAILED = 'ERR_VAL_002',

  // Unknown/Generic Errors
  UNKNOWN_ERROR = 'ERR_UNK_001',
  INTERNAL_ERROR = 'ERR_UNK_002',
}

/**
 * Base error class for RifeClaw with error code and context
 */
export class RifeClawError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;
  public readonly recoverable: boolean;
  public readonly suggestions?: string[];

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    options: {
      context?: Record<string, unknown>;
      recoverable?: boolean;
      suggestions?: string[];
    } = {}
  ) {
    super(message);
    this.name = 'RifeClawError';
    this.code = code;
    this.context = options.context;
    this.recoverable = options.recoverable ?? false;
    this.suggestions = options.suggestions;

    // Maintains proper stack trace (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RifeClawError);
    }
  }

  /**
   * Format error for display with context and suggestions
   */
  public toDisplayString(includeStack: boolean = false): string {
    const lines = [
      `❌ ${this.message}`,
      `   Code: ${this.code}`,
    ];

    if (this.context && Object.keys(this.context).length > 0) {
      lines.push('   Context:');
      for (const [key, value] of Object.entries(this.context)) {
        lines.push(`     ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (this.suggestions && this.suggestions.length > 0) {
      lines.push('   Suggestions:');
      for (const suggestion of this.suggestions) {
        lines.push(`     • ${suggestion}`);
      }
    }

    if (includeStack && this.stack) {
      lines.push('   Stack trace:');
      lines.push(this.stack.split('\n').slice(1).map(line => `     ${line}`).join('\n'));
    }

    return lines.join('\n');
  }

  /**
   * Check if error matches a specific code
   */
  public is(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Check if error is recoverable (can continue operation)
   */
  public canRecover(): boolean {
    return this.recoverable;
  }
}

/**
 * Specific error types for better type safety
 */
export class ConfigurationError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    super(message, code, { ...options, recoverable: false });
    this.name = 'ConfigurationError';
  }
}

export class FileSystemError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    super(message, code, { ...options, recoverable: false });
    this.name = 'FileSystemError';
  }
}

export class OperationError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    const rec = options.recoverable as boolean | undefined;
    super(message, code, { ...options, recoverable: rec ?? true });
    this.name = 'OperationError';
  }
}

export class AIError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    super(message, code, { ...options, recoverable: true });
    this.name = 'AIError';
  }
}

export class NetworkError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    super(message, code, { ...options, recoverable: true });
    this.name = 'NetworkError';
  }
}

export class MemoryError extends RifeClawError {
  constructor(message: string, code: ErrorCode, options: Record<string, unknown> = {}) {
    super(message, code, { ...options, recoverable: false });
    this.name = 'MemoryError';
  }
}

/**
 * Error handler utility for consistent error processing
 */
export class ErrorHandler {
  /**
   * Handle error with logging and optional recovery
   */
  static handleError(
    error: unknown,
    context: {
      source: string;
      operation?: string;
      recoverableDefault?: boolean;
      logToConsole?: boolean;
    } = { source: 'unknown' }
  ): {
    error: RifeClawError;
    shouldContinue: boolean;
  } {
    // Convert to RifeClawError if not already
    const clawError = error instanceof RifeClawError
      ? error
      : this.convertToClawError(error);

    // Log if requested
    if (context.logToConsole ?? true) {
      console.error(clawError.toDisplayString());
    }

    // Determine if we can continue
    const canContinue =
      clawError.canRecover() ||
      context.recoverableDefault === true ||
      // Specific recoverable errors
      clawError.is(ErrorCode.NETWORK_ERROR) ||
      clawError.is(ErrorCode.API_RATE_LIMITED) ||
      clawError.is(ErrorCode.AI_RATE_LIMITED);

    return {
      error: clawError,
      shouldContinue: canContinue,
    };
  }

  /**
   * Convert generic error to RifeClawError
   */
  private static convertToClawError(error: unknown): RifeClawError {
    if (error instanceof Error) {
      // Check if it's already a MissingEnvError from env.ts
      if ((error as any).name === 'MissingEnvError') {
        return new ConfigurationError(error.message, ErrorCode.MISSING_ENV_VAR, {
          variableName: (error as any).variableName,
        });
      }

      // Map common error messages to codes
      const message = error.message.toLowerCase();

      if (message.includes('not configured') || message.includes('missing')) {
        return new ConfigurationError(error.message, ErrorCode.MISSING_ENV_VAR);
      }

      if (message.includes('not found')) {
        return new FileSystemError(error.message, ErrorCode.FILE_NOT_FOUND);
      }

      if (message.includes('too large') || message.includes('exceeds')) {
        return new FileSystemError(error.message, ErrorCode.FILE_TOO_LARGE);
      }

      if (message.includes('permission denied') || message.includes('eacces')) {
        return new FileSystemError(error.message, ErrorCode.PERMISSION_DENIED);
      }

      if (message.includes('shell') || message.includes('command')) {
        return new OperationError(error.message, ErrorCode.SHELL_EXECUTION_FAILED);
      }

      if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
        return new NetworkError(error.message, ErrorCode.NETWORK_ERROR);
      }

      if (message.includes('memory') || message.includes('storage')) {
        return new MemoryError(error.message, ErrorCode.MEMORY_LOAD_FAILED);
      }
    }

    // Default to unknown error
    return new RifeClawError(
      error instanceof Error ? error.message : String(error),
      ErrorCode.UNKNOWN_ERROR
    );
  }

  /**
   * Wrap a promise with error handling
   */
  static async wrapPromise<T>(
    promise: Promise<T>,
    context: { source: string; operation?: string }
  ): Promise<{ success: true; value: T } | { success: false; error: RifeClawError }> {
    try {
      const value = await promise;
      return { success: true, value };
    } catch (error) {
      const { error: clawError } = this.handleError(error, context);
      return { success: false, error: clawError };
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    options: {
      maxAttempts?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      retryOn?: ErrorCode[];
    } = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      baseDelayMs = 1000,
      maxDelayMs = 10000,
      retryOn = [
        ErrorCode.NETWORK_ERROR,
        ErrorCode.NETWORK_TIMEOUT,
        ErrorCode.API_RATE_LIMITED,
        ErrorCode.AI_RATE_LIMITED,
      ],
    } = options;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const clawError = error instanceof RifeClawError ? error : this.convertToClawError(error);

        // Check if we should retry this error
        const shouldRetry = retryOn.some(code => clawError.is(code));
        if (!shouldRetry || attempt === maxAttempts - 1) {
          throw clawError;
        }

        // Calculate delay with exponential backoff + jitter
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelayMs
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}

/**
 * Safe execution wrapper for synchronous operations
 */
export function safeExecute<T>(
  fn: () => T,
  context: { source: string; operation?: string; fallback?: T }
): { success: true; value: T } | { success: false; error: RifeClawError } {
  try {
    const value = fn();
    return { success: true, value };
  } catch (error) {
    const { error: clawError } = ErrorHandler.handleError(error, context);
    if (context.fallback !== undefined) {
      return { success: true, value: context.fallback as T };
    }
    return { success: false, error: clawError };
  }
}