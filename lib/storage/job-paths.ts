import "server-only";

import os from "node:os";
import path from "node:path";

export type JobPaths = {
  jobDir: string;
  metadataPath: string;
  logsPath: string;
  statusPath: string;
  processCommandPath: string;
  pageCountCheckPath: string;
  sourcePdfPath: string;
  analysisRawPath: string;
  pageCommandsPath: string;
  candidatesPath: string;
  reviewPayloadPath: string;
  processRequestPath: string;
  executionMapPath: string;
  processDebugPath: string;
  processDebugSummaryPath: string;
  regressionReplayPlanPath: string;
  regressionSuiteManifestPath: string;
  processedPdfPath: string;
  processReportPath: string;
};

export function getJobsRoot(): string {
  return path.join(os.tmpdir(), "notebooklm-remover", "jobs-v2");
}

export function resolveJobPaths(jobId: string): JobPaths {
  const jobDir = path.join(getJobsRoot(), jobId);
  return {
    jobDir,
    metadataPath: path.join(jobDir, "job.json"),
    logsPath: path.join(jobDir, "logs.txt"),
    statusPath: path.join(jobDir, "status.json"),
    processCommandPath: path.join(jobDir, "process-command.txt"),
    pageCountCheckPath: path.join(jobDir, "page-count-check.json"),
    sourcePdfPath: path.join(jobDir, "source.pdf"),
    analysisRawPath: path.join(jobDir, "analysis.raw.json"),
    pageCommandsPath: path.join(jobDir, "page-commands.v1.json"),
    candidatesPath: path.join(jobDir, "candidates.v1.json"),
    reviewPayloadPath: path.join(jobDir, "review.v1.json"),
    processRequestPath: path.join(jobDir, "process-request.v2.json"),
    executionMapPath: path.join(jobDir, "execution-map.v1.json"),
    processDebugPath: path.join(jobDir, "process-debug.v1.json"),
    processDebugSummaryPath: path.join(jobDir, "process-debug-summary.v1.json"),
    regressionReplayPlanPath: path.join(jobDir, "regression-replay-plan.v1.json"),
    regressionSuiteManifestPath: path.join(jobDir, "regression-suite-manifest.v1.json"),
    processedPdfPath: path.join(jobDir, "processed.pdf"),
    processReportPath: path.join(jobDir, "process-report.json"),
  };
}
