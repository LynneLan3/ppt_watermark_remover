import "server-only";

import type { PythonRunnerResult } from "@/lib/server/python-runner/types";
import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export function classifyRunnerFailure(result: PythonRunnerResult): {
  code: TempJobErrorCode;
  message: string;
} {
  if (result.timedOut) {
    return {
      code: "runner_timeout",
      message: "Processing timed out. Please retry with a smaller or simpler file.",
    };
  }

  const stderr = result.stderr.toLowerCase();
  if (
    stderr.includes("not marked supported") ||
    stderr.includes("unsupported") ||
    stderr.includes("fail-safe abort")
  ) {
    return {
      code: "unsupported_structure",
      message: "The selected structure is currently unsupported for safe cleanup.",
    };
  }

  return {
    code: "runner_crash",
    message: "Processing failed unexpectedly in the cleanup runner.",
  };
}

export function toInternalErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Internal server error";
}
