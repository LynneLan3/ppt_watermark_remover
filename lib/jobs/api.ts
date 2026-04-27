import { NextResponse } from "next/server";

import type { JobApiResponse, JobErrorCode, JobRecord } from "@/lib/jobs/types";
import { JobNotFoundError, UploadNotFinalizedError } from "@/lib/jobs/repository";

export function jobOk<T>(message: string, data?: T, job?: JobRecord) {
  return NextResponse.json<JobApiResponse<T>>({
    success: true,
    code: "ok",
    message,
    data,
    job,
  });
}

export function jobError(params: {
  httpStatus: number;
  code: JobErrorCode;
  message: string;
  job?: JobRecord;
}) {
  return NextResponse.json<JobApiResponse<never>>(
    {
      success: false,
      code: params.code,
      message: params.message,
      job: params.job,
    },
    { status: params.httpStatus },
  );
}

export function mapRepositoryError(error: unknown): {
  code: JobErrorCode;
  message: string;
  httpStatus: number;
} {
  const message = error instanceof Error ? error.message : "internal error";
  const lower = message.toLowerCase();

  // Handle specific error types first
  if (error instanceof JobNotFoundError) {
    return {
      code: "job_not_found",
      message: `Job not found: ${error.jobId}`,
      httpStatus: 404,
    };
  }

  if (error instanceof UploadNotFinalizedError) {
    return {
      code: "upload_not_finalized",
      message: `Upload not finalized for job: ${error.jobId}`,
      httpStatus: 409,
    };
  }

  if (lower.includes("enoent") || lower.includes("no such file") || lower.includes("job not found")) {
    return {
      code: "job_not_found",
      message: "Job not found, expired, or already deleted.",
      httpStatus: 404,
    };
  }

  if (lower.includes("upload not finalized") || lower.includes("source pdf missing")) {
    return {
      code: "upload_not_finalized",
      message: "Upload not finalized. Please upload a file first.",
      httpStatus: 409,
    };
  }
  if (lower.includes("blob already exists") || lower.includes("already exists")) {
    return {
      code: "blob_path_conflict",
      message: "Temporary upload path already exists. Please try again.",
      httpStatus: 409,
    };
  }
  if (lower.includes("invalid state transition") || lower.includes("invalid state")) {
    return {
      code: "invalid_state",
      message,
      httpStatus: 409,
    };
  }
  if (lower.includes("selection is required before process")) {
    return {
      code: "invalid_state",
      message,
      httpStatus: 409,
    };
  }
  if (lower.includes("upload token invalid")) {
    return {
      code: "upload_token_invalid",
      message: "Upload token is invalid.",
      httpStatus: 401,
    };
  }
  if (lower.includes("upload token expired")) {
    return {
      code: "upload_token_expired",
      message: "Upload token has expired.",
      httpStatus: 410,
    };
  }
  if (
    lower.includes("python_process_failed") ||
    lower.includes("python process failed before all pages were completed")
  ) {
    return {
      code: "python_process_failed",
      message:
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
      httpStatus: 500,
    };
  }
  if (
    lower.includes("page_count_mismatch") ||
    lower.includes("processed page count does not match original")
  ) {
    return {
      code: "page_count_mismatch",
      message:
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
      httpStatus: 500,
    };
  }
  if (lower.includes("processed_file_missing") || lower.includes("processed pdf missing")) {
    return {
      code: "processed_file_missing",
      message:
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
      httpStatus: 500,
    };
  }
  if (lower.includes("process_report_incomplete") || lower.includes("process report incomplete")) {
    return {
      code: "process_report_incomplete",
      message:
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
      httpStatus: 500,
    };
  }
  if (
    lower.includes("only pdf uploads") ||
    lower.includes("uploaded pdf") ||
    lower.includes("parse pdf") ||
    lower.includes("pdf has") ||
    lower.includes("too large") ||
    lower.includes("empty")
  ) {
    return {
      code: "validation_error",
      message,
      httpStatus: 400,
    };
  }
  if (lower.includes("download unavailable")) {
    return {
      code: "download_unavailable",
      message: "Processed output is not available yet.",
      httpStatus: 409,
    };
  }
  return {
    code: "internal_error",
    message,
    httpStatus: 500,
  };
}
