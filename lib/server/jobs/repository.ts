import "server-only";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { JobLogger } from "@/lib/server/logging/job-logger";
import { noopJobLogger } from "@/lib/server/logging/job-logger";
import { resolveJobPaths } from "@/lib/server/temp-storage/paths";
import type {
  TempJobErrorCode,
  TempJobDeletionStatus,
  TempJobStatus,
  TempProcessingJob,
} from "@/lib/server/jobs/types";

const DEFAULT_JOB_TTL_MS = 1000 * 60 * 20;

export async function createTempJob(params: {
  originalFilename: string;
  ttlMs?: number;
  logger?: JobLogger;
}): Promise<TempProcessingJob> {
  const startedAt = Date.now();
  const logger = params.logger ?? noopJobLogger;
  const createdAt = new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_JOB_TTL_MS;
  const jobId = randomUUID();
  const paths = resolveJobPaths(jobId);

  const job: TempProcessingJob = {
    jobId,
    originalFilename: params.originalFilename,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    status: "created",
    sourcePdfPath: paths.sourcePdfPath,
    analysisJsonPath: paths.analysisJsonPath,
    cleanedPdfPath: paths.cleanedPdfPath,
    reportJsonPath: paths.reportJsonPath,
    deletionStatus: "pending",
    deletionPolicy: "delete_after_both_downloads_or_expiry",
  };

  await mkdir(paths.jobDir, { recursive: true });
  await writeJobMetadata(job);
  logger({
    level: "info",
    phase: "job_create",
    jobId,
    ok: true,
    durationMs: Date.now() - startedAt,
  });
  return job;
}

export async function saveUploadedSourceFile(
  jobId: string,
  fileBytes: Buffer | Uint8Array,
  options?: { logger?: JobLogger },
): Promise<TempProcessingJob> {
  const startedAt = Date.now();
  const logger = options?.logger ?? noopJobLogger;
  const job = await readJobMetadata(jobId);
  await mkdir(resolveJobPaths(jobId).jobDir, { recursive: true });
  await writeFile(job.sourcePdfPath, fileBytes);
  const updated = withStatus(job, "uploaded");
  await writeJobMetadata(updated);
  logger({
    level: "info",
    phase: "upload_save",
    jobId,
    ok: true,
    durationMs: Date.now() - startedAt,
  });
  return updated;
}

export async function savePlanJson(
  jobId: string,
  planJson: string,
): Promise<void> {
  const paths = resolveJobPaths(jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeFile(paths.planJsonPath, planJson, "utf-8");
}

export async function readPlanJson(jobId: string): Promise<string> {
  const paths = resolveJobPaths(jobId);
  return readFile(paths.planJsonPath, "utf-8");
}

export async function markJobStatus(
  jobId: string,
  status: TempJobStatus,
  error?: { code: TempJobErrorCode; message: string } | undefined,
): Promise<TempProcessingJob> {
  const job = await readJobMetadata(jobId);
  const updated: TempProcessingJob = {
    ...job,
    status,
    errorCode: error?.code,
    errorMessage: error?.message?.trim() || undefined,
  };
  await writeJobMetadata(updated);
  return updated;
}

export async function markDeletionStatus(
  jobId: string,
  deletionStatus: TempJobDeletionStatus,
  error?: { code: TempJobErrorCode; message: string } | undefined,
): Promise<TempProcessingJob> {
  const job = await readJobMetadata(jobId);
  const updated: TempProcessingJob = {
    ...job,
    deletionStatus,
    errorCode: error?.code ?? job.errorCode,
    errorMessage: error?.message?.trim() || job.errorMessage,
  };
  await writeJobMetadata(updated);
  return updated;
}

export async function clearJobError(jobId: string): Promise<TempProcessingJob> {
  const job = await readJobMetadata(jobId);
  const updated: TempProcessingJob = {
    ...job,
    errorCode: undefined,
    errorMessage: undefined,
  };
  await writeJobMetadata(updated);
  return updated;
}

export async function markArtifactDownloaded(
  jobId: string,
  artifact: "cleaned" | "report",
): Promise<TempProcessingJob> {
  const job = await readJobMetadata(jobId);
  const nowIso = new Date().toISOString();
  const updated: TempProcessingJob = {
    ...job,
    downloadedCleanedAt: artifact === "cleaned" ? nowIso : job.downloadedCleanedAt,
    downloadedReportAt: artifact === "report" ? nowIso : job.downloadedReportAt,
  };
  await writeJobMetadata(updated);
  return updated;
}

export function isDeletionReadyAfterDownloads(job: TempProcessingJob): boolean {
  return Boolean(job.downloadedCleanedAt && job.downloadedReportAt);
}

export async function readJobMetadata(jobId: string): Promise<TempProcessingJob> {
  const paths = resolveJobPaths(jobId);
  const raw = await readFile(paths.metadataPath, "utf-8");
  return JSON.parse(raw) as TempProcessingJob;
}

export async function writeJobMetadata(job: TempProcessingJob): Promise<void> {
  const paths = resolveJobPaths(job.jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeFile(paths.metadataPath, JSON.stringify(job, null, 2), "utf-8");
}

export async function readAnalysisResult<T = unknown>(jobId: string): Promise<T> {
  const job = await readJobMetadata(jobId);
  const raw = await readFile(job.analysisJsonPath, "utf-8");
  return JSON.parse(raw) as T;
}

export async function readReportResult<T = unknown>(jobId: string): Promise<T> {
  const job = await readJobMetadata(jobId);
  const raw = await readFile(job.reportJsonPath, "utf-8");
  return JSON.parse(raw) as T;
}

export async function hasArtifact(artifactPath: string): Promise<boolean> {
  if (!artifactPath) {
    return false;
  }
  try {
    const info = await stat(artifactPath);
    return info.isFile();
  } catch {
    return false;
  }
}

export function isJobExpired(job: TempProcessingJob, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(job.expiresAt).getTime();
}

export async function deleteJobFiles(
  jobId: string,
  options?: { logger?: JobLogger },
): Promise<void> {
  const startedAt = Date.now();
  const logger = options?.logger ?? noopJobLogger;
  const paths = resolveJobPaths(jobId);
  await rm(paths.jobDir, { recursive: true, force: true });
  logger({
    level: "info",
    phase: "job_delete",
    jobId,
    ok: true,
    durationMs: Date.now() - startedAt,
  });
}

function withStatus(job: TempProcessingJob, status: TempJobStatus): TempProcessingJob {
  return {
    ...job,
    status,
    errorCode: undefined,
    errorMessage: undefined,
  };
}
