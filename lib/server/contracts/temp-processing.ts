import type { TempJobStatus } from "@/lib/server/jobs/types";

export type CreateTempJobRequest = {
  originalFilename: string;
  ttlMs?: number;
};

export type CreateTempJobResponse = {
  jobId: string;
  status: TempJobStatus;
  expiresAt: string;
};

export type AnalyzeTempJobRequest = {
  jobId: string;
};

export type AnalyzeTempJobResponse = {
  jobId: string;
  status: TempJobStatus;
  ok: boolean;
};

export type ApplyTempJobRequest = {
  jobId: string;
  planJson?: string;
};

export type ApplyTempJobResponse = {
  jobId: string;
  status: TempJobStatus;
  ok: boolean;
};

export type DownloadTempArtifactRequest = {
  jobId: string;
  artifact: "analysis" | "cleaned" | "report";
};

export type CleanupTempJobRequest = {
  jobId: string;
};

export type CleanupTempJobResponse = {
  ok: boolean;
};
