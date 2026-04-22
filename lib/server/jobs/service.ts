import "server-only";

import { readFile } from "node:fs/promises";

import { cleanupExpiredJobs, cleanupJobById } from "@/lib/server/cleanup/expired-jobs";
import {
  isDeletionReadyAfterDownloads,
  markArtifactDownloaded,
  createTempJob,
  readAnalysisResult,
  readJobMetadata,
  readReportResult,
  savePlanJson,
  saveUploadedSourceFile,
} from "@/lib/server/jobs/repository";
import type { JobLogger } from "@/lib/server/logging/job-logger";
import { noopJobLogger } from "@/lib/server/logging/job-logger";
import { getJobArtifactPath, runAnalyzeForJob, runApplyPlanForJob } from "@/lib/server/python-runner/engine";

export async function createJobWithUpload(params: {
  originalFilename: string;
  fileBytes: Buffer | Uint8Array;
  ttlMs?: number;
  logger?: JobLogger;
}) {
  const logger = params.logger ?? noopJobLogger;
  await cleanupExpiredJobs({ logger });
  const job = await createTempJob({
    originalFilename: params.originalFilename,
    ttlMs: params.ttlMs,
    logger,
  });
  const updated = await saveUploadedSourceFile(job.jobId, params.fileBytes, { logger });
  return updated;
}

export async function analyzeJob(jobId: string, logger: JobLogger = noopJobLogger) {
  await cleanupExpiredJobs({ logger });
  const runner = await runAnalyzeForJob({ jobId, logger });
  const job = await readJobMetadata(jobId);
  return {
    job,
    runner,
  };
}

export async function applyJob(params: {
  jobId: string;
  planJson: string;
  logger?: JobLogger;
}) {
  const logger = params.logger ?? noopJobLogger;
  await cleanupExpiredJobs({ logger });
  await savePlanJson(params.jobId, params.planJson);
  const runner = await runApplyPlanForJob({
    jobId: params.jobId,
    logger,
  });
  const job = await readJobMetadata(params.jobId);
  return {
    job,
    runner,
  };
}

export async function readJobAnalysis(jobId: string) {
  return readAnalysisResult(jobId);
}

export async function readJobReport(jobId: string) {
  return readReportResult(jobId);
}

export async function readArtifactBuffer(params: {
  jobId: string;
  artifact: "analysis" | "cleaned" | "report";
}) {
  const artifactPath = await getJobArtifactPath({
    jobId: params.jobId,
    artifact: params.artifact,
  });
  return readFile(artifactPath);
}

export async function registerArtifactDownload(params: {
  jobId: string;
  artifact: "cleaned" | "report";
  logger?: JobLogger;
}) {
  const logger = params.logger ?? noopJobLogger;
  const updated = await markArtifactDownloaded(params.jobId, params.artifact);
  if (!isDeletionReadyAfterDownloads(updated)) {
    return {
      cleanupTriggered: false,
      cleanupSucceeded: false,
      job: updated,
    };
  }

  try {
    await cleanupJobById(params.jobId, logger);
    return {
      cleanupTriggered: true,
      cleanupSucceeded: true,
      job: updated,
    };
  } catch {
    return {
      cleanupTriggered: true,
      cleanupSucceeded: false,
      job: updated,
    };
  }
}

export async function cleanupSingleJob(jobId: string, logger: JobLogger = noopJobLogger) {
  try {
    await cleanupJobById(jobId, logger);
    return {
      success: true,
      errorCode: undefined,
      message: "Job cleanup completed.",
    };
  } catch (error) {
    return {
      success: false,
      errorCode: "cleanup_failed" as const,
      message: error instanceof Error ? error.message : "cleanup failed",
    };
  }
}

export async function runStartupCleanup(logger: JobLogger = noopJobLogger) {
  return cleanupExpiredJobs({ logger });
}
