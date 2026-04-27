import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import {
  deleteJobBlobs,
  getSourcePdfBuffer,
  getSourcePdfUrl,
  JobNotFoundError,
  listJobIds as listBlobJobIds,
  readJob as readJobFromBlob,
  saveSourcePdf,
  UploadNotFinalizedError,
  writeJob as writeJobToBlob,
  isBlobStorageEnabled,
} from "@/lib/blob-storage/job-store";
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

// Determine if we should use blob storage
function shouldUseBlobStorage(): boolean {
  return isBlobStorageEnabled();
}

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

  if (shouldUseBlobStorage()) {
    await writeJobToBlob(job);
  } else {
    // Fallback to local filesystem for development
    const paths = resolveJobPaths(jobId);
    await mkdir(paths.jobDir, { recursive: true });
    await writeFile(paths.metadataPath, JSON.stringify(job, null, 2), "utf-8");
  }

  return job;
}

export async function readJob(jobId: string): Promise<JobRecord> {
  if (shouldUseBlobStorage()) {
    return readJobFromBlob(jobId);
  }

  // Fallback to local filesystem
  const paths = resolveJobPaths(jobId);
  try {
    const raw = await readFile(paths.metadataPath, "utf-8");
    return JSON.parse(raw) as JobRecord;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new JobNotFoundError(jobId);
    }
    throw error;
  }
}

export async function writeJobMetadata(job: JobRecord): Promise<void> {
  if (shouldUseBlobStorage()) {
    await writeJobToBlob(job);
    return;
  }

  // Fallback to local filesystem
  const paths = resolveJobPaths(job.jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await writeFile(paths.metadataPath, JSON.stringify(job, null, 2), "utf-8");
}

// Alias for consistency with other functions
export { writeJobMetadata as writeJob };

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
  await writeJobMetadata(updated);
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

  let sourceBlobUrl: string;
  let sourcePathname: string;
  let size: number;

  if (shouldUseBlobStorage()) {
    const blob = await saveSourcePdf(params.jobId, params.file);
    sourceBlobUrl = blob.url;
    sourcePathname = blob.pathname;
    size = blob.size;
  } else {
    // Fallback to local filesystem
    const paths = resolveJobPaths(params.jobId);
    await mkdir(paths.jobDir, { recursive: true });
    const buffer = Buffer.from(await params.file.arrayBuffer());
    await writeFile(paths.sourcePdfPath, buffer);
    sourceBlobUrl = `file://${paths.sourcePdfPath}`;
    sourcePathname = paths.sourcePdfPath;
    size = buffer.length;
  }

  const updated: JobRecord = {
    ...job,
    status: "uploaded",
    updatedAt: new Date().toISOString(),
    sourceFilename: params.file.name,
    sourceBlobUrl,
    sourcePathname,
    sourceSize: size,
    sourceContentType: params.file.type || "application/pdf",
  };
  await writeJobMetadata(updated);
  return updated;
}

export async function finalizeUpload(params: {
  jobId: string;
  blobUrl: string;
  pathname: string;
  size: number;
  contentType: string;
  originalFilename: string;
}): Promise<JobRecord> {
  const job = await readJob(params.jobId);
  if (job.status !== "created") {
    throw new Error(`invalid state for upload finalization: ${job.status}`);
  }

  const updated: JobRecord = {
    ...job,
    status: "uploaded",
    updatedAt: new Date().toISOString(),
    sourceFilename: params.originalFilename,
    sourceBlobUrl: params.blobUrl,
    sourcePathname: params.pathname,
    sourceSize: params.size,
    sourceContentType: params.contentType,
  };
  await writeJobMetadata(updated);
  return updated;
}

export async function getSourcePdfForProcessing(jobId: string): Promise<{ url: string; buffer?: Buffer }> {
  if (shouldUseBlobStorage()) {
    const blobUrl = await getSourcePdfUrl(jobId);
    if (!blobUrl) {
      throw new UploadNotFinalizedError(jobId);
    }
    // For Python processing, we need to download the blob
    const buffer = await getSourcePdfBuffer(jobId);
    if (!buffer) {
      throw new UploadNotFinalizedError(jobId);
    }
    return { url: blobUrl, buffer };
  }

  // Fallback to local filesystem
  const paths = resolveJobPaths(jobId);
  try {
    const buffer = await readFile(paths.sourcePdfPath);
    return { url: `file://${paths.sourcePdfPath}`, buffer };
  } catch {
    throw new UploadNotFinalizedError(jobId);
  }
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
  await writeJobMetadata(updated);
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

  // Write analysis artifacts
  if (shouldUseBlobStorage()) {
    // For blob storage, we store analysis JSON alongside job manifest
    const { put } = await import("@vercel/blob");
    const analysisPathname = `${getJobsRoot()}/${params.jobId}/analysis.raw.json`;
    const pageCommandsPathname = `${getJobsRoot()}/${params.jobId}/page-commands.v1.json`;
    const candidatesPathname = `${getJobsRoot()}/${params.jobId}/candidates.v1.json`;
    const reviewPathname = `${getJobsRoot()}/${params.jobId}/review.v1.json`;

    await Promise.all([
      put(analysisPathname, JSON.stringify(params.rawAnalysis, null, 2), {
        contentType: "application/json",
        access: "private",
        allowOverwrite: true,
      }),
      put(pageCommandsPathname, JSON.stringify(params.pageCommands, null, 2), {
        contentType: "application/json",
        access: "private",
        allowOverwrite: true,
      }),
      put(candidatesPathname, JSON.stringify(params.candidates, null, 2), {
        contentType: "application/json",
        access: "private",
        allowOverwrite: true,
      }),
      put(reviewPathname, JSON.stringify(params.reviewPayload, null, 2), {
        contentType: "application/json",
        access: "private",
        allowOverwrite: true,
      }),
    ]);

    const analysis: JobAnalysisSnapshot = {
      analyzedAt: new Date().toISOString(),
      totalRawCandidates: countRawCandidates(params.rawAnalysis),
      totalPageCommands: countPageCommands(params.pageCommands),
      totalV1Candidates: params.candidates.length,
      rawAnalysisPath: analysisPathname,
      pageCommandsPath: pageCommandsPathname,
      candidatesPath: candidatesPathname,
      reviewPayloadPath: reviewPathname,
    };

    const updated: JobRecord = {
      ...job,
      status: "ready_for_review",
      updatedAt: new Date().toISOString(),
      analysis,
    };
    await writeJobMetadata(updated);
    return updated;
  }

  // Fallback to local filesystem
  await mkdir(paths.jobDir, { recursive: true });
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
  await writeJobMetadata(updated);
  return updated;
}

export async function readReviewPayload(jobId: string): Promise<JobReviewPayload | null> {
  const paths = resolveJobPaths(jobId);

  if (shouldUseBlobStorage()) {
    try {
      const { get } = await import("@vercel/blob");
      const reviewPathname = `${getJobsRoot()}/${jobId}/review.v1.json`;
      const response = await get(reviewPathname, { access: "private" });
      if (!response || response.statusCode !== 200) return null;
      // Read stream to text
      const reader = response.stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(result);
      return JSON.parse(text) as JobReviewPayload;
    } catch {
      return null;
    }
  }

  // Fallback to local filesystem
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
  await writeJobMetadata(updated);
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

  let outputBlobUrl: string | undefined;
  let reportBlobUrl: string | undefined;

  if (shouldUseBlobStorage()) {
    const { put } = await import("@vercel/blob");
    const { readFile } = await import("node:fs/promises");

    // Upload processed PDF to blob
    const outputBuffer = await readFile(params.outputPdfPath);
    const outputBlob = await put(`${getJobsRoot()}/${jobId}/processed.pdf`, outputBuffer, {
      contentType: "application/pdf",
      access: "private",
      allowOverwrite: true,
    });
    outputBlobUrl = outputBlob.url;

    // Upload report to blob
    const reportBuffer = await readFile(params.reportPath);
    const reportBlob = await put(`${getJobsRoot()}/${jobId}/process-report.json`, reportBuffer, {
      contentType: "application/json",
      access: "private",
      allowOverwrite: true,
    });
    reportBlobUrl = reportBlob.url;
  }

  const updated: JobRecord = {
    ...job,
    status: "ready_for_download",
    updatedAt: new Date().toISOString(),
    processOutputPath: params.outputPdfPath,
    processReportPath: params.reportPath,
    processOutputBlobUrl: outputBlobUrl,
    processReportBlobUrl: reportBlobUrl,
  };
  await writeJobMetadata(updated);
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
  await writeJobMetadata(updated);
  return updated;
}

export async function deleteJob(jobId: string): Promise<void> {
  if (shouldUseBlobStorage()) {
    await deleteJobBlobs(jobId);
    return;
  }

  // Fallback to local filesystem
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
  await writeJobMetadata(updated);
  return updated;
}

export async function listJobIds(): Promise<string[]> {
  if (shouldUseBlobStorage()) {
    return listBlobJobIds();
  }

  // Fallback to local filesystem
  try {
    return await readdir(getJobsRoot());
  } catch {
    return [];
  }
}

export async function fileExists(pathname: string): Promise<boolean> {
  if (shouldUseBlobStorage()) {
    // For blob storage, we check if the URL is accessible
    if (pathname.startsWith("http")) {
      try {
        const { head } = await import("@vercel/blob");
        const info = await head(pathname);
        return info !== null;
      } catch {
        return false;
      }
    }
    return false;
  }

  // Fallback to local filesystem
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

// Re-export errors for use in API routes
export { JobNotFoundError, UploadNotFinalizedError };

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
