import "server-only";

import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export function classifyApiError(error: unknown): {
  code: TempJobErrorCode;
  message: string;
  httpStatus: number;
} {
  const message = error instanceof Error ? error.message : "Internal server error";
  const lower = message.toLowerCase();
  if (lower.includes("enoent") || lower.includes("no such file")) {
    return {
      code: "artifact_missing",
      message: "Job data is missing, expired, or already deleted.",
      httpStatus: 410,
    };
  }
  return {
    code: "internal_error",
    message,
    httpStatus: 500,
  };
}
