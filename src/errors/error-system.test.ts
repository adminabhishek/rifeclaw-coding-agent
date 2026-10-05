import { describe, expect, test } from "bun:test";
import {
  RifeClawError,
  ErrorCode,
  ErrorHandler,
  ConfigurationError,
  FileSystemError,
  OperationError,
  AIError,
  NetworkError,
  MemoryError,
  safeExecute,
} from "./error-system.ts";

describe("RifeClawError", () => {
  test("creates error with code and message", () => {
    const err = new RifeClawError("Something went wrong", ErrorCode.UNKNOWN_ERROR);
    expect(err.message).toBe("Something went wrong");
    expect(err.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(err.name).toBe("RifeClawError");
  });

  test("supports context and suggestions", () => {
    const err = new RifeClawError("Bad", ErrorCode.FILE_NOT_FOUND, {
      context: { path: "/tmp/test.ts" },
      suggestions: ["Check the file path"],
    });
    expect(err.context).toEqual({ path: "/tmp/test.ts" });
    expect(err.suggestions).toEqual(["Check the file path"]);
  });

  test("canRecover returns false by default", () => {
    const err = new RifeClawError("Bad", ErrorCode.UNKNOWN_ERROR);
    expect(err.canRecover()).toBe(false);
  });

  test("canRecover returns true when recoverable is set", () => {
    const err = new RifeClawError("Bad", ErrorCode.NETWORK_ERROR, {
      recoverable: true,
    });
    expect(err.canRecover()).toBe(true);
  });

  test("is() checks error code", () => {
    const err = new RifeClawError("Bad", ErrorCode.FILE_NOT_FOUND);
    expect(err.is(ErrorCode.FILE_NOT_FOUND)).toBe(true);
    expect(err.is(ErrorCode.FILE_TOO_LARGE)).toBe(false);
  });

  test("toDisplayString includes code and message", () => {
    const err = new RifeClawError("Test error", ErrorCode.FILE_NOT_FOUND);
    const display = err.toDisplayString();
    expect(display).toContain("Test error");
    expect(display).toContain("ERR_FS_001");
  });

  test("toDisplayString includes suggestions", () => {
    const err = new RifeClawError("Test", ErrorCode.MISSING_ENV_VAR, {
      suggestions: ["Run setup"],
    });
    const display = err.toDisplayString();
    expect(display).toContain("Run setup");
  });
});

describe("Error Subclasses", () => {
  test("ConfigurationError has correct name and is not recoverable", () => {
    const err = new ConfigurationError("Config bad", ErrorCode.MISSING_ENV_VAR);
    expect(err.name).toBe("ConfigurationError");
    expect(err.canRecover()).toBe(false);
  });

  test("FileSystemError has correct name and is not recoverable", () => {
    const err = new FileSystemError("FS bad", ErrorCode.FILE_NOT_FOUND);
    expect(err.name).toBe("FileSystemError");
    expect(err.canRecover()).toBe(false);
  });

  test("OperationError has correct name and is recoverable by default", () => {
    const err = new OperationError("Op bad", ErrorCode.SHELL_EXECUTION_FAILED);
    expect(err.name).toBe("OperationError");
    expect(err.canRecover()).toBe(true);
  });

  test("AIError has correct name and is recoverable by default", () => {
    const err = new AIError("AI bad", ErrorCode.AI_API_ERROR);
    expect(err.name).toBe("AIError");
    expect(err.canRecover()).toBe(true);
  });

  test("NetworkError has correct name and is recoverable by default", () => {
    const err = new NetworkError("Network bad", ErrorCode.NETWORK_ERROR);
    expect(err.name).toBe("NetworkError");
    expect(err.canRecover()).toBe(true);
  });

  test("MemoryError has correct name and is not recoverable", () => {
    const err = new MemoryError("Memory bad", ErrorCode.MEMORY_SAVE_FAILED);
    expect(err.name).toBe("MemoryError");
    expect(err.canRecover()).toBe(false);
  });
});

describe("ErrorHandler", () => {
  test("handleError converts generic Error to RifeClawError", () => {
    const result = ErrorHandler.handleError(new Error("Something bad"));
    expect(result.error).toBeInstanceOf(RifeClawError);
    expect(result.error.message).toBe("Something bad");
  });

  test("handleError maps 'not found' to FILE_NOT_FOUND", () => {
    const result = ErrorHandler.handleError(new Error("File not found: test.ts"));
    expect(result.error.is(ErrorCode.FILE_NOT_FOUND)).toBe(true);
    expect(result.error).toBeInstanceOf(FileSystemError);
  });

  test("handleError maps 'too large' to FILE_TOO_LARGE", () => {
    const result = ErrorHandler.handleError(new Error("File too large"));
    expect(result.error.is(ErrorCode.FILE_TOO_LARGE)).toBe(true);
  });

  test("handleError maps 'permission' to PERMISSION_DENIED", () => {
    const result = ErrorHandler.handleError(new Error("Permission denied"));
    expect(result.error.is(ErrorCode.PERMISSION_DENIED)).toBe(true);
  });

  test("handleError maps 'network' to NETWORK_ERROR", () => {
    const result = ErrorHandler.handleError(new Error("Network failure"));
    expect(result.error.is(ErrorCode.NETWORK_ERROR)).toBe(true);
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  test("handleError maps 'shell' to SHELL_EXECUTION_FAILED", () => {
    const result = ErrorHandler.handleError(new Error("Shell command error"));
    expect(result.error.is(ErrorCode.SHELL_EXECUTION_FAILED)).toBe(true);
  });

  test("handleError returns shouldContinue=true for recoverable errors", () => {
    const result = ErrorHandler.handleError(
      new Error("Network timeout"),
      { source: "test" }
    );
    expect(result.shouldContinue).toBe(true);
  });

  test("handleError returns shouldContinue=false for non-recoverable errors", () => {
    const result = ErrorHandler.handleError(
      new Error("Config file not found"),
      { source: "test" }
    );
    expect(result.shouldContinue).toBe(false);
  });

  test("wrapPromise returns success for resolved promises", async () => {
    const result = await ErrorHandler.wrapPromise(
      Promise.resolve("success"),
      { source: "test" }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("success");
    }
  });

  test("wrapPromise returns failure for rejected promises", async () => {
    const result = await ErrorHandler.wrapPromise(
      Promise.reject(new Error("Failed")),
      { source: "test" }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Failed");
    }
  });
});

describe("safeExecute", () => {
  test("returns value on success", () => {
    const result = safeExecute(() => "result", { source: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("result");
    }
  });

  test("returns error on throw", () => {
    const result = safeExecute(() => {
      throw new Error("Failed");
    }, { source: "test" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Failed");
    }
  });

  test("returns fallback value when provided", () => {
    const result = safeExecute(
      () => {
        throw new Error("Failed");
      },
      { source: "test", fallback: "default" }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("default");
    }
  });
});

describe("retryWithBackoff", () => {
  test("succeeds on first try", async () => {
    let attempts = 0;
    const result = await ErrorHandler.retryWithBackoff(async () => {
      attempts++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  test("retries on network errors", async () => {
    let attempts = 0;
    const result = await ErrorHandler.retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new NetworkError("Network down", ErrorCode.NETWORK_ERROR);
        }
        return "ok";
      },
      { maxAttempts: 5, baseDelayMs: 10 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws on non-retryable error", async () => {
    await expect(async () => {
      await ErrorHandler.retryWithBackoff(
        async () => {
          throw new FileSystemError("File bad", ErrorCode.FILE_NOT_FOUND);
        },
        { maxAttempts: 3, baseDelayMs: 10 }
      );
    }).toThrowError("File bad");
  });
});