import { NextResponse } from "next/server";

import type { TempJobErrorCode, TempProcessingJob, TempJobStatus } from "@/lib/server/jobs/types";

export type ApiPayload<T> = {
  success: boolean;
  status: TempJobStatus | "error";
  message: string;
  errorCode?: TempJobErrorCode;
  job?: Pick<
    TempProcessingJob,
    | "jobId"
    | "status"
    | "createdAt"
    | "expiresAt"
    | "deletionStatus"
    | "deletionPolicy"
    | "errorCode"
    | "errorMessage"
  >;
  data?: T;
};

export function apiOk<T>(params: {
  status: TempJobStatus;
  message: string;
  data?: T;
  job?: TempProcessingJob;
}) {
  return NextResponse.json<ApiPayload<T>>({
    success: true,
    status: params.status,
    message: params.message,
    job: params.job ? pickJobMeta(params.job) : undefined,
    data: params.data,
  });
}

export function apiError<T = never>(params: {
  httpStatus: number;
  status?: TempJobStatus | "error";
  code: TempJobErrorCode;
  message: string;
  job?: TempProcessingJob;
  data?: T;
}) {
  return NextResponse.json<ApiPayload<T>>(
    {
      success: false,
      status: params.status ?? "error",
      errorCode: params.code,
      message: params.message,
      job: params.job ? pickJobMeta(params.job) : undefined,
      data: params.data,
    },
    { status: params.httpStatus },
  );
}

export function pickJobMeta(job: TempProcessingJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    deletionStatus: job.deletionStatus,
    deletionPolicy: job.deletionPolicy,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  };
}
