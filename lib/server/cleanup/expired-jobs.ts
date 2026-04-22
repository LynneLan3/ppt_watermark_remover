import "server-only";

import { readdir } from "node:fs/promises";

import {
  deleteJobFiles,
  isJobExpired,
  markDeletionStatus,
  readJobMetadata,
} from "@/lib/server/jobs/repository";
import type { JobLogger } from "@/lib/server/logging/job-logger";
import { noopJobLogger } from "@/lib/server/logging/job-logger";
import { getTempJobsRoot } from "@/lib/server/temp-storage/paths";

export type CleanupSummary = {
  scannedJobs: number;
  deletedJobs: string[];
  failedJobs: Array<{ jobId: string; error: string }>;
};

export async function cleanupExpiredJobs(params?: {
  now?: Date;
  logger?: JobLogger;
}): Promise<CleanupSummary> {
  const startedAt = Date.now();
  const now = params?.now ?? new Date();
  const logger = params?.logger ?? noopJobLogger;
  const root = getTempJobsRoot();

  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return {
      scannedJobs: 0,
      deletedJobs: [],
      failedJobs: [],
    };
  }

  const summary: CleanupSummary = {
    scannedJobs: entries.length,
    deletedJobs: [],
    failedJobs: [],
  };

  for (const jobId of entries) {
    try {
      const job = await readJobMetadata(jobId);
      if (!isJobExpired(job, now)) {
        continue;
      }
      await markDeletionStatus(jobId, "deleted");
      await deleteJobFiles(jobId, { logger });
      summary.deletedJobs.push(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown cleanup error";
      summary.failedJobs.push({ jobId, error: message });
      try {
        await markDeletionStatus(jobId, "failed", {
          code: "cleanup_failed",
          message,
        });
      } catch {
        // ignore metadata update errors during cleanup fallback
      }
    }
  }

  logger({
    level: summary.failedJobs.length > 0 ? "warn" : "info",
    phase: "cleanup",
    ok: summary.failedJobs.length === 0,
    durationMs: Date.now() - startedAt,
    message: `scanned=${summary.scannedJobs} deleted=${summary.deletedJobs.length} failed=${summary.failedJobs.length}`,
  });

  return summary;
}

export async function cleanupJobById(
  jobId: string,
  logger: JobLogger = noopJobLogger,
): Promise<void> {
  try {
    await markDeletionStatus(jobId, "deleted");
  } catch {
    // job metadata may already be gone
  }
  try {
    await deleteJobFiles(jobId, { logger });
  } catch (error) {
    const message = error instanceof Error ? error.message : "cleanup failed";
    try {
      await markDeletionStatus(jobId, "failed", {
        code: "cleanup_failed",
        message,
      });
    } catch {
      // ignore second-order cleanup failures
    }
    throw error;
  }
}
