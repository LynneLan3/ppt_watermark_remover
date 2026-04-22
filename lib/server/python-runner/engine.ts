import "server-only";

import { markJobStatus, readJobMetadata } from "@/lib/server/jobs/repository";
import { classifyRunnerFailure } from "@/lib/server/errors/classify";
import type { JobLogger } from "@/lib/server/logging/job-logger";
import { noopJobLogger } from "@/lib/server/logging/job-logger";
import { resolveJobPaths } from "@/lib/server/temp-storage/paths";
import { runPythonCommand } from "@/lib/server/python-runner/process";
import type { PythonRunnerResult } from "@/lib/server/python-runner/types";

function getCliScriptPath(): string {
  return "engine/python/cli.py";
}

export async function runAnalyzeForJob(params: {
  jobId: string;
  logger?: JobLogger;
}): Promise<PythonRunnerResult> {
  const startedAt = Date.now();
  const logger = params.logger ?? noopJobLogger;
  const job = await markJobStatus(params.jobId, "analyzing");
  const paths = resolveJobPaths(params.jobId);
  const args = [
    getCliScriptPath(),
    "analyze",
    "--input",
    job.sourcePdfPath,
    "--output",
    paths.analysisJsonPath,
  ];
  const result = await runPythonCommand({
    commandName: "analyze",
    args,
    options: {
      timeoutMs: 45_000,
    },
  });

  const classifiedError = result.ok ? undefined : classifyRunnerFailure(result);
  await markJobStatus(
    params.jobId,
    result.ok ? "analyzed" : "error",
    classifiedError
      ? {
          code: classifiedError.code,
          message: `${classifiedError.message} ${normalizeErrorMessage(result)}`.trim(),
        }
      : undefined,
  );

  logger({
    level: result.ok ? "info" : "error",
    phase: "analyze",
    jobId: params.jobId,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    message: compactRunnerMessage(result),
  });

  return result;
}

export async function runApplyPlanForJob(params: {
  jobId: string;
  planPath?: string;
  logger?: JobLogger;
}): Promise<PythonRunnerResult> {
  const startedAt = Date.now();
  const logger = params.logger ?? noopJobLogger;
  const job = await markJobStatus(params.jobId, "applying");
  const paths = resolveJobPaths(params.jobId);
  const args = [
    getCliScriptPath(),
    "apply-plan",
    "--input",
    job.sourcePdfPath,
    "--plan",
    params.planPath ?? paths.planJsonPath,
    "--output",
    paths.cleanedPdfPath,
    "--report",
    paths.reportJsonPath,
  ];
  const result = await runPythonCommand({
    commandName: "apply-plan",
    args,
    options: {
      timeoutMs: 75_000,
    },
  });

  const classifiedError = result.ok ? undefined : classifyRunnerFailure(result);
  await markJobStatus(
    params.jobId,
    result.ok ? "completed" : "error",
    classifiedError
      ? {
          code: classifiedError.code,
          message: `${classifiedError.message} ${normalizeErrorMessage(result)}`.trim(),
        }
      : undefined,
  );

  logger({
    level: result.ok ? "info" : "error",
    phase: "apply",
    jobId: params.jobId,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    message: compactRunnerMessage(result),
  });

  return result;
}

export async function getJobArtifactPath(params: {
  jobId: string;
  artifact: "source" | "analysis" | "cleaned" | "report" | "plan";
}): Promise<string> {
  const job = await readJobMetadata(params.jobId);
  const paths = resolveJobPaths(params.jobId);
  if (params.artifact === "source") {
    return job.sourcePdfPath;
  }
  if (params.artifact === "analysis") {
    return job.analysisJsonPath;
  }
  if (params.artifact === "cleaned") {
    return job.cleanedPdfPath;
  }
  if (params.artifact === "report") {
    return job.reportJsonPath;
  }
  return paths.planJsonPath;
}

function normalizeErrorMessage(result: PythonRunnerResult): string {
  const stderr = result.stderr.trim();
  if (stderr) {
    return trimMessage(stderr, 1000);
  }
  if (result.timedOut) {
    return "python runner timed out";
  }
  return "python runner failed";
}

function compactRunnerMessage(result: PythonRunnerResult): string {
  const details = [
    `exit=${String(result.exitCode)}`,
    `timedOut=${result.timedOut ? "1" : "0"}`,
    `stdout=${result.stdout.length}ch`,
    `stderr=${result.stderr.length}ch`,
  ];
  return details.join(" ");
}

function trimMessage(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
