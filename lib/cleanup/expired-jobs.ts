import "server-only";

import { deleteJob, expireJob, listJobIds, readJob } from "@/lib/jobs/repository";

export type ExpiredCleanupSummary = {
  scanned: number;
  expired: string[];
  failed: Array<{ jobId: string; reason: string }>;
};

export async function cleanupExpiredJobs(now: Date = new Date()): Promise<ExpiredCleanupSummary> {
  const ids = await listJobIds();
  const summary: ExpiredCleanupSummary = {
    scanned: ids.length,
    expired: [],
    failed: [],
  };

  for (const jobId of ids) {
    try {
      const job = await readJob(jobId);
      const shouldExpire = new Date(job.expiresAt).getTime() <= now.getTime();
      if (!shouldExpire) {
        continue;
      }
      await expireJob(jobId);
      await deleteJob(jobId);
      summary.expired.push(jobId);
    } catch (error) {
      summary.failed.push({
        jobId,
        reason: error instanceof Error ? error.message : "unknown cleanup error",
      });
    }
  }
  return summary;
}
