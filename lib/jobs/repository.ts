import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import { resolveJobPaths, type JobPaths, getJobsRoot } from "@/lib/storage/job-paths";
import type {
  JobAnalysisSnapshot,
  JobErrorCode,
  JobRecord,
  JobReviewPayload,
  JobSelection,
  JobSelectionItem,
  JobStatus,
  CleanupCandidate,
} from "@/lib/jobs/types";

const DEFAULT_RETENTION_SECONDS = 60 * 20;

const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  created: ["uploaded", "expired", "failed"],
  uploaded: ["analyzing", "processing", "expired", "failed"],
  analyzing: ["ready_for_review", "expired", "failed"],
  ready_for_review: ["processing", "expired", "failed"],
  processing: ["ready_for_download", "partial_failed", "expired", "failed"],
  ready_for_download: ["downloaded", "expired", "failed"],
  downloaded: ["expired"],
  partial_failed: ["expired", "failed"],
  expired: [],
  failed: ["expired"],
};

export async function createJob(retentionSeconds = DEFAULT_RETENTION_SECONDS): Promise<JobRecord> {
  const jobId = randomUUID();
  const now = new Date();
  const job: JobRecord = {
    jobId,
    status: "created",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + retentionSeconds * 1000).toISOString(),
    retentionSeconds,
  };
  const paths = resolveJobPaths(jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeJob(job);
  return job;
}

export async function readJob(jobId: string): Promise<JobRecord> {
  const paths = resolveJobPaths(jobId);
  const raw = await readFile(paths.metadataPath, "utf-8");
  return JSON.parse(raw) as JobRecord;
}

export async function writeJob(job: JobRecord): Promise<void> {
  const paths = resolveJobPaths(job.jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeFile(paths.metadataPath, JSON.stringify(job, null, 2), "utf-8");
}

export async function transitionJobStatus(
  jobId: string,
  nextStatus: JobStatus,
  failure?: { code: JobErrorCode; message: string },
): Promise<JobRecord> {
  const job = await readJob(jobId);
  if (job.status !== nextStatus) {
    const allowed = ALLOWED_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`invalid state transition: ${job.status} -> ${nextStatus}`);
    }
  }
  const updated: JobRecord = {
    ...job,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    failureCode: failure?.code,
    failureMessage: failure?.message,
  };
  await writeJob(updated);
  return updated;
}

export async function saveUploadedSource(params: {
  jobId: string;
  file: File;
}): Promise<JobRecord> {
  const job = await readJob(params.jobId);
  if (job.status !== "created") {
    throw new Error(`invalid state for upload: ${job.status}`);
  }
  const paths = resolveJobPaths(params.jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeFile(paths.sourcePdfPath, Buffer.from(await params.file.arrayBuffer()));
  const updated: JobRecord = {
    ...job,
    status: "uploaded",
    updatedAt: new Date().toISOString(),
    sourceFilename: params.file.name,
    sourcePdfPath: paths.sourcePdfPath,
  };
  await writeJob(updated);
  return updated;
}

export async function setUploadToken(
  jobId: string,
  ttlSeconds: number,
): Promise<{ job: JobRecord; uploadToken: string; expiresAt: string }> {
  const job = await readJob(jobId);
  if (job.status !== "created") {
    throw new Error(`invalid state for upload token: ${job.status}`);
  }
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const updated: JobRecord = {
    ...job,
    updatedAt: new Date().toISOString(),
    uploadToken: token,
    uploadTokenExpiresAt: expiresAt,
  };
  await writeJob(updated);
  return { job: updated, uploadToken: token, expiresAt };
}

export async function verifyUploadToken(params: {
  jobId: string;
  uploadToken: string;
}): Promise<JobRecord> {
  const job = await readJob(params.jobId);
  if (!job.uploadToken || job.uploadToken !== params.uploadToken) {
    throw new Error("upload token invalid");
  }
  const expiresAt = job.uploadTokenExpiresAt ? new Date(job.uploadTokenExpiresAt).getTime() : 0;
  if (!expiresAt || Date.now() > expiresAt) {
    throw new Error("upload token expired");
  }
  return job;
}

export async function persistAnalyzeOutputs(params: {
  jobId: string;
  rawAnalysis: unknown;
  pageCommands: unknown;
  candidates: CleanupCandidate[];
  reviewPayload: JobReviewPayload;
}): Promise<JobRecord> {
  const job = await readJob(params.jobId);
  const paths = resolveJobPaths(params.jobId);
  await writeFile(paths.analysisRawPath, JSON.stringify(params.rawAnalysis, null, 2), "utf-8");
  await writeFile(paths.pageCommandsPath, JSON.stringify(params.pageCommands, null, 2), "utf-8");
  await writeFile(paths.candidatesPath, JSON.stringify(params.candidates, null, 2), "utf-8");
  await writeFile(paths.reviewPayloadPath, JSON.stringify(params.reviewPayload, null, 2), "utf-8");
  const analysis: JobAnalysisSnapshot = {
    analyzedAt: new Date().toISOString(),
    totalRawCandidates: countRawCandidates(params.rawAnalysis),
    totalPageCommands: countPageCommands(params.pageCommands),
    totalV1Candidates: params.candidates.length,
    rawAnalysisPath: paths.analysisRawPath,
    pageCommandsPath: paths.pageCommandsPath,
    candidatesPath: paths.candidatesPath,
    reviewPayloadPath: paths.reviewPayloadPath,
  };
  const updated: JobRecord = {
    ...job,
    status: "ready_for_review",
    updatedAt: new Date().toISOString(),
    analysis,
  };
  await writeJob(updated);
  return updated;
}

export async function readReviewPayload(jobId: string): Promise<JobReviewPayload | null> {
  const paths = resolveJobPaths(jobId);
  try {
    const raw = await readFile(paths.reviewPayloadPath, "utf-8");
    return JSON.parse(raw) as JobReviewPayload;
  } catch {
    return null;
  }
}

export async function saveSelection(jobId: string, items: JobSelectionItem[]): Promise<JobRecord> {
  const job = await readJob(jobId);
  if (job.status !== "ready_for_review") {
    throw new Error(`invalid state for selection: ${job.status}`);
  }
  const selection: JobSelection = {
    items,
    updatedAt: new Date().toISOString(),
  };
  const updated: JobRecord = {
    ...job,
    selection,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function persistProcessOutput(params: {
  jobId: string;
  outputPdfPath: string;
  reportPath: string;
}): Promise<JobRecord> {
  const jobId = params.jobId;
  const job = await readJob(jobId);
  if (job.status !== "processing") {
    throw new Error(`invalid state for process: ${job.status}`);
  }
  const updated: JobRecord = {
    ...job,
    status: "ready_for_download",
    updatedAt: new Date().toISOString(),
    processOutputPath: params.outputPdfPath,
    processReportPath: params.reportPath,
  };
  await writeJob(updated);
  return updated;
}

export async function markDownloaded(jobId: string): Promise<JobRecord> {
  const job = await readJob(jobId);
  if (job.status !== "ready_for_download" && job.status !== "downloaded") {
    throw new Error(`invalid state for download: ${job.status}`);
  }
  const updated: JobRecord = {
    ...job,
    status: "downloaded",
    updatedAt: new Date().toISOString(),
    downloadedAt: job.downloadedAt ?? new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function deleteJob(jobId: string): Promise<void> {
  const paths = resolveJobPaths(jobId);
  await rm(paths.jobDir, { recursive: true, force: true });
}

export async function expireJob(jobId: string): Promise<JobRecord> {
  const job = await readJob(jobId);
  const updated: JobRecord = {
    ...job,
    status: "expired",
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function listJobIds(): Promise<string[]> {
  try {
    return await readdir(getJobsRoot());
  } catch {
    return [];
  }
}

export async function fileExists(pathname: string): Promise<boolean> {
  try {
    const info = await stat(pathname);
    return info.isFile();
  } catch {
    return false;
  }
}

export function resolvePaths(jobId: string): JobPaths {
  return resolveJobPaths(jobId);
}

function countRawCandidates(rawAnalysis: unknown): number {
  if (!rawAnalysis || typeof rawAnalysis !== "object") {
    return 0;
  }
  const maybePages = (rawAnalysis as { candidatesByPage?: Record<string, unknown[]> }).candidatesByPage;
  if (!maybePages) {
    return 0;
  }
  return Object.values(maybePages).reduce((sum, candidates) => sum + candidates.length, 0);
}

function countPageCommands(pageCommandsPayload: unknown): number {
  if (!pageCommandsPayload || typeof pageCommandsPayload !== "object") {
    return 0;
  }
  const rows = (pageCommandsPayload as { pageCommands?: unknown[] }).pageCommands;
  return Array.isArray(rows) ? rows.length : 0;
}
