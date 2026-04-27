import "server-only";

import os from "node:os";
import path from "node:path";

import type { TempJobPaths } from "@/lib/server/jobs/types";

export function getTempJobsRoot(): string {
  return path.join(os.tmpdir(), "notebooklm-remover", "jobs");
}

export function resolveJobPaths(jobId: string): TempJobPaths {
  const jobDir = path.join(getTempJobsRoot(), jobId);
  return {
    jobDir,
    metadataPath: path.join(jobDir, "job.json"),
    sourcePdfPath: path.join(jobDir, "source.pdf"),
    analysisJsonPath: path.join(jobDir, "analysis.json"),
    cleanedPdfPath: path.join(jobDir, "cleaned.pdf"),
    reportJsonPath: path.join(jobDir, "report.json"),
    planJsonPath: path.join(jobDir, "plan.json"),
  };
}
