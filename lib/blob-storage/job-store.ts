import "server-only";

import { del, get, head, list, put } from "@vercel/blob";

import type { JobRecord } from "@/lib/jobs/types";

const BLOB_JOBS_PREFIX = "jobs/";

function getJobManifestPathname(jobId: string): string {
  return `${BLOB_JOBS_PREFIX}${jobId}/job.json`;
}

function getSourcePdfPathname(jobId: string): string {
  return `${BLOB_JOBS_PREFIX}${jobId}/source.pdf`;
}

export class JobNotFoundError extends Error {
  readonly jobId: string;
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

export class UploadNotFinalizedError extends Error {
  readonly jobId: string;
  constructor(jobId: string) {
    super(`Upload not finalized for job: ${jobId}`);
    this.name = "UploadNotFinalizedError";
    this.jobId = jobId;
  }
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
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
  return new TextDecoder().decode(result);
}

export async function readJob(jobId: string): Promise<JobRecord> {
  const pathname = getJobManifestPathname(jobId);
  try {
    const response = await get(pathname, { access: "private" });
    if (!response || response.statusCode !== 200) {
      throw new JobNotFoundError(jobId);
    }
    const text = await streamToText(response.stream);
    return JSON.parse(text) as JobRecord;
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("not found")) {
      throw new JobNotFoundError(jobId);
    }
    throw error;
  }
}

export async function writeJob(job: JobRecord): Promise<void> {
  const pathname = getJobManifestPathname(job.jobId);
  await put(pathname, JSON.stringify(job, null, 2), {
    contentType: "application/json",
    access: "private",
  });
}

export async function patchJob(
  jobId: string,
  patch: Partial<JobRecord>,
): Promise<JobRecord> {
  const job = await readJob(jobId);
  const updated: JobRecord = {
    ...job,
    ...patch,
    jobId, // Ensure jobId is not overwritten
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function saveSourcePdf(
  jobId: string,
  file: File | Buffer | Uint8Array,
): Promise<{ url: string; pathname: string; size: number }> {
  const pathname = getSourcePdfPathname(jobId);

  let blobResult: { url: string; pathname: string; size: number };
  if (file instanceof File) {
    const blob = await put(pathname, file, {
      contentType: file.type || "application/pdf",
      access: "private",
    });
    blobResult = { url: blob.url, pathname: blob.pathname, size: file.size };
  } else if (file instanceof Buffer) {
    const blob = await put(pathname, file, {
      contentType: "application/pdf",
      access: "private",
    });
    blobResult = { url: blob.url, pathname: blob.pathname, size: file.length };
  } else {
    // Uint8Array - convert to Buffer
    const buffer = Buffer.from(file);
    const blob = await put(pathname, buffer, {
      contentType: "application/pdf",
      access: "private",
    });
    blobResult = { url: blob.url, pathname: blob.pathname, size: buffer.length };
  }

  return blobResult;
}

export async function getSourcePdfUrl(jobId: string): Promise<string | null> {
  const pathname = getSourcePdfPathname(jobId);
  try {
    const info = await head(pathname);
    return info?.url ?? null;
  } catch {
    return null;
  }
}

export async function getSourcePdfBuffer(jobId: string): Promise<Buffer | null> {
  const pathname = getSourcePdfPathname(jobId);
  try {
    const response = await get(pathname, { access: "private" });
    if (!response || response.statusCode !== 200) {
      return null;
    }
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
    return Buffer.from(result);
  } catch {
    return null;
  }
}

export async function deleteJobBlobs(jobId: string): Promise<void> {
  const prefix = `${BLOB_JOBS_PREFIX}${jobId}/`;
  try {
    const { blobs } = await list({ prefix });
    if (blobs.length > 0) {
      await del(blobs.map((b) => b.url));
    }
  } catch {
    // Ignore cleanup errors
  }
}

export async function listJobIds(): Promise<string[]> {
  try {
    const { blobs } = await list({ prefix: BLOB_JOBS_PREFIX });
    const jobIds = new Set<string>();
    for (const blob of blobs) {
      const match = blob.pathname.match(/^jobs\/([^/]+)\//);
      if (match) {
        jobIds.add(match[1]);
      }
    }
    return Array.from(jobIds);
  } catch {
    return [];
  }
}

export function isBlobStorageEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
