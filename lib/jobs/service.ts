import "server-only";

import { access, constants, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import { PDFDocument } from "pdf-lib";

import { buildAnalyzeV1Review } from "@/lib/cleanup/analyze-v1";
import { buildImageSkippedSummary } from "@/lib/jobs/image-skipped-summary";
import {
  createJob,
  deleteJob,
  expireJob,
  fileExists,
  markDownloaded,
  persistAnalyzeOutputs,
  persistProcessOutput,
  readJob,
  readReviewPayload,
  resolvePaths,
  saveSelection,
  saveUploadedSource,
  setUploadToken,
  transitionJobStatus,
  verifyUploadToken,
  writeJobMetadata,
  getSourcePdfForProcessing,
  UploadNotFinalizedError,
  SourcePdfNotFoundError,
  SourcePdfReadFailedError,
} from "@/lib/jobs/repository";
import type {
  JobErrorCode,
  JobRecord,
  ImageSkippedSummary,
  JobReviewPayload,
  JobSelectionItem,
  ProcessReportV2,
  QualityMetrics,
} from "@/lib/jobs/types";
import { runPythonCommand } from "@/lib/server/python-runner/process";
import type { PythonRunnerResult } from "@/lib/server/python-runner/types";
import { getStorageAdapter } from "@/lib/storage/local-adapter";
import { validateUploadedPdf } from "@/lib/storage/upload";
import { isBlobStorageEnabled } from "@/lib/blob-storage/job-store";
import { readSourcePdfBuffer } from "@/lib/blob-storage/source-reader";
import { analyzePdfWithJsFallback, type JsAnalyzeFallbackResult } from "@/lib/jobs/js-analyze-fallback";

const DEFAULT_ALGORITHM_PROFILE = "stable-light-complex-v5";

class ProcessJobFailure extends Error {
  readonly code: JobErrorCode;
  readonly status: "failed" | "partial_failed";

  constructor(code: JobErrorCode, message: string, status: "failed" | "partial_failed" = "failed") {
    super(`${code.toUpperCase()}: ${message}`);
    this.code = code;
    this.status = status;
    this.name = "ProcessJobFailure";
  }
}

export type AnalyzePhase =
  | "resolve_source_input"
  | "read_source_pdf_from_blob"
  | "validate_pdf_buffer"
  | "run_pdf_analyzer"
  | "parse_analyzer_output"
  | "write_analysis_result"
  | "patch_job_ready_for_review";

export type AnalyzeFailureCode =
  | "source_pdf_not_found"
  | "source_pdf_read_failed"
  | "pdf_buffer_empty"
  | "pdf_analyzer_runtime_missing"
  | "pdf_analyzer_script_missing"
  | "pdf_analyzer_dependency_missing"
  | "pdf_analyzer_failed"
  | "pdf_analyzer_output_invalid"
  | "analysis_write_failed"
  | "analyze_failed";

export class AnalyzePhaseError extends Error {
  readonly code: AnalyzeFailureCode;
  readonly phase: AnalyzePhase;
  readonly details?: Record<string, unknown>;

  constructor(code: AnalyzeFailureCode, phase: AnalyzePhase, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AnalyzePhaseError";
    this.code = code;
    this.phase = phase;
    this.details = details;
  }
}

export type AnalyzeTraceItem = {
  phase: AnalyzePhase;
  message: string;
  ok: boolean;
  meta?: Record<string, unknown>;
};

export function getWatermarkAlgorithmProfile(): string {
  return process.env.WATERMARK_ALGORITHM_PROFILE || DEFAULT_ALGORITHM_PROFILE;
}

export async function createStage2Job(): Promise<JobRecord> {
  return createJob();
}

export async function issueUploadToken(jobId: string): Promise<{
  job: JobRecord;
  uploadToken: string;
  expiresAt: string;
}> {
  return setUploadToken(jobId, 10 * 60);
}

export async function uploadSourcePdf(params: {
  jobId: string;
  uploadToken: string;
  file: File;
}): Promise<JobRecord> {
  const validation = await validateUploadedPdf(params.file);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  await verifyUploadToken({
    jobId: params.jobId,
    uploadToken: params.uploadToken,
  });
  return saveUploadedSource({
    jobId: params.jobId,
    file: params.file,
  });
}

export async function analyzeJobV1(jobId: string): Promise<{ job: JobRecord; review: JobReviewPayload }> {
  const job = await readJob(jobId);

  // Check for source PDF - must have both sourceBlobUrl and sourcePathname
  const hasFinalizedUpload = Boolean(job.sourceBlobUrl) && Boolean(job.sourcePathname);
  if (!hasFinalizedUpload) {
    throw new UploadNotFinalizedError(jobId);
  }

  // Update status to analyzing
  await transitionJobStatus(jobId, "analyzing");

  const paths = resolvePaths(jobId);
  const previousReview = await readReviewPayload(jobId);

  // Determine input path for Python analysis
  let inputPdfPath: string;
  let cleanupTempFile: (() => Promise<void>) | undefined;

  if (job.sourcePathname && !isBlobStorageEnabled() && job.sourcePathname.startsWith("file://")) {
    // Local filesystem mode
    inputPdfPath = job.sourcePathname.replace("file://", "");
  } else if (job.sourceBlobUrl) {
    // Blob storage mode - download to temp file for Python processing
    // getSourcePdfForProcessing throws SourcePdfNotFoundError or SourcePdfReadFailedError on failure
    const sourceResult = await getSourcePdfForProcessing(jobId);

    // Write to temp file for Python processing
    const tempDir = join(tmpdir(), "notebooklm-jobs", jobId);
    await mkdir(tempDir, { recursive: true });
    inputPdfPath = join(tempDir, "source.pdf");
    await writeFile(inputPdfPath, sourceResult.buffer);

    cleanupTempFile = async () => {
      try {
        const { rm } = await import("node:fs/promises");
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    };
  } else {
    await transitionJobStatus(jobId, "failed", {
      code: "upload_not_finalized",
      message: "Source PDF not available for processing",
    });
    throw new UploadNotFinalizedError(jobId);
  }

  try {
    const result = await runPythonCommand({
      commandName: "analyze",
      args: [
        "engine/python/cli.py",
        "analyze",
        "--input",
        inputPdfPath,
        "--output",
        paths.analysisRawPath,
      ],
      options: {
        timeoutMs: 45_000,
      },
    });
    if (!result.ok) {
      await transitionJobStatus(jobId, "failed", {
        code: "analysis_failed",
        message: result.stderr || "python analyze failed",
      });
      throw new Error(result.stderr || "python analyze failed");
    }

    const extractResult = await runPythonCommand({
      commandName: "extract-commands",
      args: [
        "python/extract_page_commands.py",
        "--input",
        inputPdfPath,
        "--output",
        paths.pageCommandsPath,
      ],
      options: {
        timeoutMs: 45_000,
      },
    });
    if (!extractResult.ok) {
      await transitionJobStatus(jobId, "failed", {
        code: "analysis_failed",
        message: extractResult.stderr || "python extract page commands failed",
      });
      throw new Error(extractResult.stderr || "python extract page commands failed");
    }
  } catch (error) {
    // Don't wrap source PDF errors - let them propagate with correct error codes
    if (error instanceof SourcePdfNotFoundError || error instanceof SourcePdfReadFailedError) {
      // Mark job as failed but re-throw the original error
      const currentJob = await readJob(jobId);
      if (currentJob.status !== "failed") {
        const code = error instanceof SourcePdfNotFoundError ? "source_pdf_not_found" : "source_pdf_read_failed";
        await transitionJobStatus(jobId, "failed", {
          code,
          message: error.message,
        });
      }
      throw error;
    }

    // Ensure job is marked as failed on any error
    const errorMessage = error instanceof Error ? error.message : "Analysis failed";
    // Only update status if not already failed (to avoid overwriting specific error codes)
    const currentJob = await readJob(jobId);
    if (currentJob.status !== "failed") {
      await transitionJobStatus(jobId, "failed", {
        code: "analysis_failed",
        message: errorMessage,
      });
    }
    throw error;
  } finally {
    // Cleanup temp file if it was created
    if (cleanupTempFile) {
      await cleanupTempFile();
    }
  }

  const rawAnalysis = await getStorageAdapter().readJson<unknown>(paths.analysisRawPath);
  const pageCommandsPayload = await getStorageAdapter().readJson<unknown>(paths.pageCommandsPath);
  const { candidates, reviewPayload } = buildAnalyzeV1Review({
    rawAnalysis,
    pageCommandsRaw: pageCommandsPayload,
    previousMetrics: previousReview?.qualityMetrics ?? null,
  });
  const updated = await persistAnalyzeOutputs({
    jobId,
    rawAnalysis,
    pageCommands: pageCommandsPayload,
    candidates,
    reviewPayload,
  });
  return {
    job: updated,
    review: reviewPayload,
  };
}

export async function analyzeJobV1Stateless(params: {
  jobId: string;
  sourcePathname?: string;
  sourceBlobUrl?: string;
  enableJsFallback?: boolean;
}): Promise<{
  job: JobRecord | null;
  review: JobReviewPayload;
  sourcePathname: string;
  sourceBlobUrl: string;
  analysisPath: string;
  analyzer: "python" | "js-fallback";
  analyzerFallbackReason?: string;
  trace: AnalyzeTraceItem[];
  pdfBufferBytes: number;
  runtimeCheck: {
    python3Available: boolean;
    pythonAvailable: boolean;
    analyzerScriptExists: boolean;
    extractScriptExists: boolean;
    dependencyCheck: "ok" | "missing" | "skipped";
    dependencyMessage?: string;
  };
  lastRunnerResult?: PythonRunnerResult;
  analysisObject: unknown;
}> {
  const { jobId } = params;
  const paths = resolvePaths(jobId);
  const previousReview = await readReviewPayload(jobId);
  const trace: AnalyzeTraceItem[] = [];
  const enableJsFallback = params.enableJsFallback ?? false;
  const runtimeCheck: {
    python3Available: boolean;
    pythonAvailable: boolean;
    analyzerScriptExists: boolean;
    extractScriptExists: boolean;
    dependencyCheck: "skipped" | "ok" | "missing";
    dependencyMessage?: string;
  } = {
    python3Available: false,
    pythonAvailable: false,
    analyzerScriptExists: false,
    extractScriptExists: false,
    dependencyCheck: "skipped",
    dependencyMessage: undefined,
  };
  let lastRunnerResult: PythonRunnerResult | undefined;

  const sourcePathname = params.sourcePathname ?? "";
  const sourceBlobUrl = params.sourceBlobUrl ?? "";
  trace.push({
    phase: "resolve_source_input",
    message: "Source input resolved.",
    ok: true,
    meta: {
      hasSourcePathname: Boolean(sourcePathname),
      hasSourceBlobUrl: Boolean(sourceBlobUrl),
    },
  });

  let buffer: Buffer;
  try {
    const source = await readSourcePdfBuffer({
      sourcePathname,
      sourceBlobUrl,
    });
    buffer = source.buffer;
    trace.push({
      phase: "read_source_pdf_from_blob",
      message: "Source PDF read from blob.",
      ok: true,
      meta: {
        bytes: buffer.byteLength,
      },
    });
  } catch (error) {
    if (error instanceof SourcePdfNotFoundError) {
      throw new AnalyzePhaseError("source_pdf_not_found", "read_source_pdf_from_blob", error.message);
    }
    if (error instanceof SourcePdfReadFailedError) {
      throw new AnalyzePhaseError("source_pdf_read_failed", "read_source_pdf_from_blob", error.message);
    }
    throw new AnalyzePhaseError("analyze_failed", "read_source_pdf_from_blob", "Failed to read source PDF.");
  }

  if (!buffer || buffer.byteLength <= 0) {
    throw new AnalyzePhaseError("pdf_buffer_empty", "validate_pdf_buffer", "Source PDF buffer is empty.", {
      pdfBufferBytes: buffer?.byteLength ?? 0,
    });
  }
  trace.push({
    phase: "validate_pdf_buffer",
    message: "PDF buffer validated.",
    ok: true,
    meta: { bytes: buffer.byteLength },
  });

  const tempDir = join(tmpdir(), "notebooklm-jobs", `${jobId}-analyze`);
  await mkdir(tempDir, { recursive: true });
  const inputPdfPath = join(tempDir, "source.pdf");
  await writeFile(inputPdfPath, buffer);

  let persistedJob: JobRecord | null = null;
  let analysisObject: unknown = null;
  let analyzer: "python" | "js-fallback" = "python";
  let analyzerFallbackReason: string | undefined;
  try {
    try {
      const existing = await readJob(jobId);
      const updated: JobRecord = {
        ...existing,
        sourcePathname: sourcePathname || existing.sourcePathname,
        sourceBlobUrl: sourceBlobUrl || existing.sourceBlobUrl,
        status: existing.status === "created" ? "uploaded" : existing.status,
        updatedAt: new Date().toISOString(),
      };
      await writeJobMetadata(updated);
      try {
        await transitionJobStatus(jobId, "analyzing");
      } catch {
        // Stateless mode: status transition failure should not block analysis.
      }
    } catch {
      // Stateless mode: missing manifest should not block analysis.
    }

    const analyzerScriptPath = "engine/python/cli.py";
    const extractScriptPath = "python/extract_page_commands.py";
    runtimeCheck.python3Available = await isPythonBinaryAvailable("python3");
    runtimeCheck.pythonAvailable = await isPythonBinaryAvailable("python");
    runtimeCheck.analyzerScriptExists = await fileExistsForScript(analyzerScriptPath);
    runtimeCheck.extractScriptExists = await fileExistsForScript(extractScriptPath);
    const dependencyCheck = await checkPythonDependencies();
    runtimeCheck.dependencyCheck = dependencyCheck.ok ? "ok" : "missing";
    runtimeCheck.dependencyMessage = dependencyCheck.message;

    trace.push({
      phase: "run_pdf_analyzer",
      message: "Analyzer runtime check complete.",
      ok: true,
      meta: {
        ...runtimeCheck,
      },
    });

    if (!runtimeCheck.python3Available && !runtimeCheck.pythonAvailable) {
      throw new AnalyzePhaseError(
        "pdf_analyzer_runtime_missing",
        "run_pdf_analyzer",
        "Python runtime is unavailable.",
        {
          ...runtimeCheck,
          pdfBufferBytes: buffer.byteLength,
        },
      );
    }
    if (!runtimeCheck.analyzerScriptExists || !runtimeCheck.extractScriptExists) {
      throw new AnalyzePhaseError(
        "pdf_analyzer_script_missing",
        "run_pdf_analyzer",
        "Analyzer script is missing.",
        {
          analyzerScriptExists: runtimeCheck.analyzerScriptExists,
          extractScriptExists: runtimeCheck.extractScriptExists,
          pdfBufferBytes: buffer.byteLength,
        },
      );
    }
    if (runtimeCheck.dependencyCheck === "missing") {
      throw new AnalyzePhaseError(
        "pdf_analyzer_dependency_missing",
        "run_pdf_analyzer",
        runtimeCheck.dependencyMessage || "Python analyzer dependency missing.",
        {
          dependencyMessage: runtimeCheck.dependencyMessage,
          pdfBufferBytes: buffer.byteLength,
        },
      );
    }

    const analyzeResult = await runPythonCommand({
      commandName: "analyze",
      args: [analyzerScriptPath, "analyze", "--input", inputPdfPath, "--output", paths.analysisRawPath],
      options: {
        timeoutMs: 45_000,
      },
    });
    lastRunnerResult = analyzeResult;
    if (!analyzeResult.ok) {
      throw new AnalyzePhaseError(
        "pdf_analyzer_failed",
        "run_pdf_analyzer",
        analyzeResult.stderr || "python analyze failed",
        {
          exitCode: analyzeResult.exitCode,
          stderr: analyzeResult.stderr,
          stdout: analyzeResult.stdout,
        },
      );
    }

    const extractResult = await runPythonCommand({
      commandName: "extract-commands",
      args: [extractScriptPath, "--input", inputPdfPath, "--output", paths.pageCommandsPath],
      options: {
        timeoutMs: 45_000,
      },
    });
    lastRunnerResult = extractResult;
    if (!extractResult.ok) {
      throw new AnalyzePhaseError(
        "pdf_analyzer_failed",
        "run_pdf_analyzer",
        extractResult.stderr || "python extract page commands failed",
        {
          exitCode: extractResult.exitCode,
          stderr: extractResult.stderr,
          stdout: extractResult.stdout,
        },
      );
    }

    let rawAnalysis: unknown;
    let pageCommandsPayload: unknown;
    try {
      rawAnalysis = await getStorageAdapter().readJson<unknown>(paths.analysisRawPath);
      pageCommandsPayload = await getStorageAdapter().readJson<unknown>(paths.pageCommandsPath);
    } catch (error) {
      throw new AnalyzePhaseError(
        "pdf_analyzer_output_invalid",
        "parse_analyzer_output",
        error instanceof Error ? error.message : "Invalid analyzer output.",
        {
          stderr: lastRunnerResult?.stderr,
          stdout: lastRunnerResult?.stdout,
          exitCode: lastRunnerResult?.exitCode,
        },
      );
    }
    trace.push({
      phase: "parse_analyzer_output",
      message: "Analyzer output parsed.",
      ok: true,
    });

    const { candidates, reviewPayload } = buildAnalyzeV1Review({
      rawAnalysis,
      pageCommandsRaw: pageCommandsPayload,
      previousMetrics: previousReview?.qualityMetrics ?? null,
    });
    analysisObject = rawAnalysis;

    try {
      persistedJob = await persistAnalyzeOutputs({
        jobId,
        rawAnalysis,
        pageCommands: pageCommandsPayload,
        candidates,
        reviewPayload,
      });
      trace.push({
        phase: "write_analysis_result",
        message: "Analysis result persisted.",
        ok: true,
      });
    } catch (error) {
      throw new AnalyzePhaseError(
        "analysis_write_failed",
        "write_analysis_result",
        error instanceof Error ? error.message : "Failed to write analysis result.",
      );
    }

    try {
      if (persistedJob) {
        await writeJobMetadata(persistedJob);
      }
      trace.push({
        phase: "patch_job_ready_for_review",
        message: "Job patch completed.",
        ok: true,
      });
    } catch (error) {
      console.warn("[analyzeJobV1Stateless] patch job failed (continuing)", {
        jobId,
        error: error instanceof Error ? error.message : "unknown",
      });
      trace.push({
        phase: "patch_job_ready_for_review",
        message: "Job patch failed but analysis succeeded.",
        ok: false,
      });
    }

    return {
      job: persistedJob,
      review: reviewPayload,
      sourcePathname,
      sourceBlobUrl,
      analysisPath: paths.analysisRawPath,
      analyzer,
      analyzerFallbackReason,
      trace,
      pdfBufferBytes: buffer.byteLength,
      runtimeCheck,
      lastRunnerResult,
      analysisObject,
    };
  } catch (error) {
    const maybePhaseError = error instanceof AnalyzePhaseError ? error : null;
    const fallbackEligibleCode = maybePhaseError?.code;
    const shouldFallbackToJs =
      enableJsFallback &&
      (fallbackEligibleCode === "pdf_analyzer_runtime_missing" ||
        fallbackEligibleCode === "pdf_analyzer_script_missing" ||
        fallbackEligibleCode === "pdf_analyzer_dependency_missing");

    if (!shouldFallbackToJs) {
      if (error instanceof AnalyzePhaseError) {
        throw new AnalyzePhaseError(error.code, error.phase, error.message, {
          ...(error.details ?? {}),
          trace,
          runtimeCheck,
          pdfBufferBytes: buffer.byteLength,
        });
      }
      throw error;
    }

    const fallbackReason =
      fallbackEligibleCode === "pdf_analyzer_runtime_missing"
        ? "python_runtime_missing"
        : fallbackEligibleCode === "pdf_analyzer_script_missing"
          ? "python_script_missing"
          : "python_dependency_missing";
    analyzer = "js-fallback";
    analyzerFallbackReason = fallbackReason;
    const jsFallback = await analyzePdfWithJsFallback(buffer) as JsAnalyzeFallbackResult;

    const fallbackReview = buildFallbackReviewPayload(jsFallback.pageCount);
    analysisObject = jsFallback;
    trace.push({
      phase: "run_pdf_analyzer",
      message: `Python analyzer unavailable, fallback to JS analyzer (${fallbackReason}).`,
      ok: false,
      meta: {
        fallbackReason,
      },
    });
    try {
      await getStorageAdapter().writeJson(paths.analysisRawPath, jsFallback);
      await getStorageAdapter().writeJson(paths.pageCommandsPath, { pageCommands: [] });
      await getStorageAdapter().writeJson(paths.candidatesPath, []);
      await getStorageAdapter().writeJson(paths.reviewPayloadPath, fallbackReview);
      trace.push({
        phase: "write_analysis_result",
        message: "Fallback analysis result persisted.",
        ok: true,
      });
    } catch (writeError) {
      throw new AnalyzePhaseError(
        "analysis_write_failed",
        "write_analysis_result",
        writeError instanceof Error ? writeError.message : "Failed to write JS fallback analysis.",
      );
    }

    try {
      const existing = await readJob(jobId);
      const updated: JobRecord = {
        ...existing,
        status: "ready_for_review",
        sourcePathname: sourcePathname || existing.sourcePathname,
        sourceBlobUrl: sourceBlobUrl || existing.sourceBlobUrl,
        updatedAt: new Date().toISOString(),
      };
      await writeJobMetadata(updated);
      persistedJob = updated;
      trace.push({
        phase: "patch_job_ready_for_review",
        message: "Job patched after JS fallback.",
        ok: true,
      });
    } catch {
      trace.push({
        phase: "patch_job_ready_for_review",
        message: "Job patch skipped after JS fallback.",
        ok: false,
      });
    }

    return {
      job: persistedJob,
      review: fallbackReview,
      sourcePathname,
      sourceBlobUrl,
      analysisPath: paths.analysisRawPath,
      analyzer,
      analyzerFallbackReason,
      trace,
      pdfBufferBytes: buffer.byteLength,
      runtimeCheck,
      lastRunnerResult,
      analysisObject,
    };
  } finally {
    try {
      const { rm } = await import("node:fs/promises");
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

export async function getJobWithReview(jobId: string): Promise<{
  job: JobRecord;
  reviewPayload: JobReviewPayload | null;
  processReport: ProcessReportV2 | null;
  imageSkippedSummary: ImageSkippedSummary | null;
  replayPlan: Record<string, unknown> | null;
  suiteManifest: Record<string, unknown> | null;
}> {
  const job = await readJob(jobId);
  const reviewPayload = await readReviewPayload(jobId);
  const paths = resolvePaths(jobId);
  const processReport = await readOptionalJson<ProcessReportV2>(paths.processReportPath);
  const imageSkippedSummary =
    processReport && reviewPayload
      ? buildImageSkippedSummary({
          processReport,
          candidates: reviewPayload.candidates,
        })
      : null;
  const replayPlan = await readOptionalJson<Record<string, unknown>>(paths.regressionReplayPlanPath);
  const suiteManifest = await readOptionalJson<Record<string, unknown>>(paths.regressionSuiteManifestPath);
  return { job, reviewPayload, processReport, imageSkippedSummary, replayPlan, suiteManifest };
}

export async function saveJobSelection(
  jobId: string,
  items: JobSelectionItem[],
): Promise<{
  job: JobRecord;
  reviewPayload: JobReviewPayload | null;
}> {
  const job = await saveSelection(jobId, items);
  const reviewPayload = await readReviewPayload(jobId);
  return { job, reviewPayload };
}

export async function processJob(
  jobId: string,
  params: { processMode?: "object_level_v2" | "raster_repair_v1" } = {},
): Promise<JobRecord> {
  await transitionJobStatus(jobId, "processing");
  const paths = resolvePaths(jobId);
  const pageCountCheck: {
    originalPageCount: number | null;
    processedPageCount: number | null;
    processReportPageCount: number | null;
    pythonExitCode: number | null;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
  } = {
    originalPageCount: null,
    processedPageCount: null,
    processReportPageCount: null,
    pythonExitCode: null,
    status: "processing",
    errorCode: null,
    errorMessage: null,
  };
  let inputPdfPath: string;
  let cleanupTempFile: (() => Promise<void>) | undefined;

  try {
    const job = await readJob(jobId);

    // Check for source PDF - must have both sourceBlobUrl and sourcePathname
    const hasFinalizedUpload = Boolean(job.sourceBlobUrl) && Boolean(job.sourcePathname);
    if (!hasFinalizedUpload) {
      throw new UploadNotFinalizedError(jobId);
    }

    // Determine input path for Python processing
    if (job.sourcePathname && !isBlobStorageEnabled() && job.sourcePathname.startsWith("file://")) {
      // Local filesystem mode
      inputPdfPath = job.sourcePathname.replace("file://", "");
    } else if (job.sourceBlobUrl) {
      // Blob storage mode - download to temp file for Python processing
      const sourceResult = await getSourcePdfForProcessing(jobId);
      if (!sourceResult.buffer) {
        throw new UploadNotFinalizedError(jobId);
      }

      // Write to temp file for Python processing
      const tempDir = join(tmpdir(), "notebooklm-jobs", jobId);
      await mkdir(tempDir, { recursive: true });
      inputPdfPath = join(tempDir, "source.pdf");
      await writeFile(inputPdfPath, sourceResult.buffer);

      cleanupTempFile = async () => {
        try {
          const { rm } = await import("node:fs/promises");
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      };
    } else {
      throw new UploadNotFinalizedError(jobId);
    }

    const reviewPayload = await readReviewPayload(jobId);
    const processMode = params.processMode ?? "raster_repair_v1";
    if (processMode === "object_level_v2" && !reviewPayload) {
      throw new Error("review payload missing");
    }
    if (processMode === "object_level_v2" && (!job.selection || job.selection.items.length <= 0)) {
      throw new Error("selection is required before process");
    }
    const selections = job.selection?.items ?? [];
    const candidates = reviewPayload?.candidates ?? [];

    const requestPayload = {
      jobId: job.jobId,
      sourcePdfPath: inputPdfPath,
      outputPdfPath: paths.processedPdfPath,
      reportPath: paths.processReportPath,
      executionMapPath: paths.executionMapPath,
      processDebugPath: paths.processDebugPath,
      processDebugSummaryPath: paths.processDebugSummaryPath,
      regressionReplayPlanPath: paths.regressionReplayPlanPath,
      regressionSuiteManifestPath: paths.regressionSuiteManifestPath,
      pageCommandsPath: paths.pageCommandsPath,
      selection: selections,
      candidates,
      processMode,
      algorithmProfile: getWatermarkAlgorithmProfile(),
      rasterProcessConfig:
        processMode === "raster_repair_v1"
          ? {
              watermarkRegionHint: reviewPayload?.watermarkRegionHint ?? "right_bottom",
              roi: {
                widthRatio: 0.16,
                heightRatio: 0.08,
              },
              renderScale: 2.5,
              enableSeamMicroPolish: false,
            }
          : undefined,
      previousMetrics: (await readExistingProcessMetrics(paths.processReportPath)) ?? null,
    };
    await getStorageAdapter().writeJson(paths.processRequestPath, requestPayload);
    await getStorageAdapter().writeJson(paths.executionMapPath, buildExecutionMap(selections, candidates));

    const commandArgs =
      processMode === "raster_repair_v1"
        ? [
            "python/process_raster_watermark_v1.py",
            "--request",
            paths.processRequestPath,
            "--input",
            inputPdfPath,
            "--output",
            paths.processedPdfPath,
            "--report",
            paths.processReportPath,
          ]
        : [
            "python/process_pdf_v2.py",
            "--request",
            paths.processRequestPath,
            "--input",
            inputPdfPath,
            "--output",
            paths.processedPdfPath,
            "--report",
            paths.processReportPath,
          ];
    const processCommandText = `python3 ${commandArgs.join(" ")}`;
    await writeFile(paths.processCommandPath, `${processCommandText}\n`, "utf-8");

    const result = await runPythonCommand({
      commandName: processMode === "raster_repair_v1" ? "process-raster-v1" : "process-v2",
      args: commandArgs,
      options: {
        timeoutMs: processMode === "raster_repair_v1" ? 180_000 : 90_000,
      },
    });

    await writeFile(
      paths.logsPath,
      [
        `command=${processCommandText}`,
        `exitCode=${result.exitCode ?? "null"}`,
        `ok=${result.ok}`,
        `timedOut=${result.timedOut}`,
        `durationMs=${result.durationMs}`,
        "",
        "[stdout]",
        result.stdout.trim(),
        "",
        "[stderr]",
        result.stderr.trim(),
        "",
      ].join("\n"),
      "utf-8",
    );

    const report = await readOptionalJson<ProcessReportV2>(paths.processReportPath);
    const originalPageCount = await readPdfPageCount(inputPdfPath);
    const processedFileExists = await fileExists(paths.processedPdfPath);
    const processedPageCount = processedFileExists ? await readPdfPageCount(paths.processedPdfPath) : 0;
    const processReportPageCount = resolveProcessReportPageCount(report);
    const processReportComplete = isProcessReportComplete(report, originalPageCount);

    pageCountCheck.originalPageCount = originalPageCount;
    pageCountCheck.processedPageCount = processedPageCount;
    pageCountCheck.processReportPageCount = processReportPageCount;
    pageCountCheck.pythonExitCode = result.exitCode;
    pageCountCheck.status = "checking";

    if (!result.ok) {
      throw new ProcessJobFailure(
        "python_process_failed",
        "Processing failed before all pages were completed. Please try another PDF or report this issue.",
        "failed",
      );
    }
    if (!processedFileExists) {
      throw new ProcessJobFailure(
        "processed_file_missing",
        "Processing failed before all pages were completed. Please try another PDF or report this issue.",
        "failed",
      );
    }
    if (processedPageCount !== originalPageCount) {
      throw new ProcessJobFailure(
        "page_count_mismatch",
        "Processing failed before all pages were completed. Please try another PDF or report this issue.",
        processedPageCount > 0 ? "partial_failed" : "failed",
      );
    }
    if (!processReportComplete) {
      throw new ProcessJobFailure(
        "process_report_incomplete",
        "Processing failed before all pages were completed. Please try another PDF or report this issue.",
        "failed",
      );
    }
    if (report?.fatalError) {
      throw new ProcessJobFailure(
        "python_process_failed",
        "Processing failed before all pages were completed. Please try another PDF or report this issue.",
        "failed",
      );
    }

    await writeFile(
      paths.pageCountCheckPath,
      JSON.stringify(
          {
            ...pageCountCheck,
            status: "ready_for_download",
        },
        null,
        2,
      ),
      "utf-8",
    );

    await writeFile(
      paths.statusPath,
      JSON.stringify(
        {
          jobId,
          status: "ready_for_download",
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );

    return await persistProcessOutput({
      jobId,
      outputPdfPath: paths.processedPdfPath,
      reportPath: paths.processReportPath,
    });
  } catch (error) {
    if (error instanceof ProcessJobFailure) {
      const message =
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.";
      await transitionJobStatus(jobId, error.status, {
        code: error.code,
        message,
      });
      await writeFile(
        paths.pageCountCheckPath,
        JSON.stringify(
          {
            originalPageCount: pageCountCheck.originalPageCount,
            processedPageCount: pageCountCheck.processedPageCount,
            processReportPageCount: pageCountCheck.processReportPageCount,
            pythonExitCode: pageCountCheck.pythonExitCode,
            status: error.status,
            errorCode: error.code.toUpperCase(),
            errorMessage: message,
          },
          null,
          2,
        ),
        "utf-8",
      );
      await writeFile(
        paths.statusPath,
        JSON.stringify(
          {
            jobId,
            status: error.status,
            errorCode: error.code,
            errorMessage: message,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );
      throw error;
    }

    await transitionJobStatus(jobId, "failed", {
      code: "process_failed",
      message:
        "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
    });
    pageCountCheck.status = "failed";
    pageCountCheck.errorCode = "PROCESS_FAILED";
    pageCountCheck.errorMessage =
      "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.";
    await writeFile(paths.pageCountCheckPath, JSON.stringify(pageCountCheck, null, 2), "utf-8");
    await writeFile(
      paths.statusPath,
      JSON.stringify(
        {
          jobId,
          status: "failed",
          errorCode: "process_failed",
          errorMessage:
            "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    throw error;
  } finally {
    // Cleanup temp file if it was created
    if (cleanupTempFile) {
      await cleanupTempFile();
    }
  }
}

export async function processJobStateless(params: {
  jobId: string;
  sourcePathname?: string;
  sourceBlobUrl?: string;
  processMode?: "object_level_v2" | "raster_repair_v1";
  analysisPath?: string;
  analysis?: Record<string, unknown>;
}): Promise<{
  job: JobRecord | null;
  outputPath: string;
  reportPath: string;
  outputBlobUrl: string | null;
  reportBlobUrl: string | null;
  processMode: "raster_repair_v1" | "object_level_v2" | "passthrough-fallback";
  warning?: string;
}> {
  const { jobId } = params;
  const paths = resolvePaths(jobId);
  const processMode = params.processMode ?? "raster_repair_v1";

  const sourcePathname = params.sourcePathname ?? "";
  const sourceBlobUrl = params.sourceBlobUrl ?? "";
  const { buffer } = await readSourcePdfBuffer({
    sourcePathname,
    sourceBlobUrl,
  });

  const tempDir = join(tmpdir(), "notebooklm-jobs", `${jobId}-process`);
  await mkdir(tempDir, { recursive: true });
  const inputPdfPath = join(tempDir, "source.pdf");
  await writeFile(inputPdfPath, buffer);

  let outputBlobUrl: string | null = null;
  let reportBlobUrl: string | null = null;
  let persistedJob: JobRecord | null = null;
  let effectiveProcessMode: "raster_repair_v1" | "object_level_v2" | "passthrough-fallback" = processMode;
  let warning: string | undefined;

  try {
    if (params.analysisPath) {
      // Keep provided metadata for debug and replay in stateless mode.
      await getStorageAdapter().writeJson(paths.analysisRawPath, {
        analysisPath: params.analysisPath,
      });
    } else if (params.analysis) {
      await getStorageAdapter().writeJson(paths.analysisRawPath, params.analysis);
    }

    const requestPayload = {
      jobId,
      sourcePdfPath: inputPdfPath,
      outputPdfPath: paths.processedPdfPath,
      reportPath: paths.processReportPath,
      executionMapPath: paths.executionMapPath,
      processDebugPath: paths.processDebugPath,
      processDebugSummaryPath: paths.processDebugSummaryPath,
      regressionReplayPlanPath: paths.regressionReplayPlanPath,
      regressionSuiteManifestPath: paths.regressionSuiteManifestPath,
      pageCommandsPath: paths.pageCommandsPath,
      selection: [],
      candidates: [],
      processMode,
      algorithmProfile: getWatermarkAlgorithmProfile(),
      rasterProcessConfig:
        processMode === "raster_repair_v1"
          ? {
              watermarkRegionHint: "right_bottom",
              roi: {
                widthRatio: 0.16,
                heightRatio: 0.08,
              },
              renderScale: 2.5,
              enableSeamMicroPolish: false,
            }
          : undefined,
      previousMetrics: null,
    };
    await getStorageAdapter().writeJson(paths.processRequestPath, requestPayload);

    const commandArgs =
      processMode === "raster_repair_v1"
        ? [
            "python/process_raster_watermark_v1.py",
            "--request",
            paths.processRequestPath,
            "--input",
            inputPdfPath,
            "--output",
            paths.processedPdfPath,
            "--report",
            paths.processReportPath,
          ]
        : [
            "python/process_pdf_v2.py",
            "--request",
            paths.processRequestPath,
            "--input",
            inputPdfPath,
            "--output",
            paths.processedPdfPath,
            "--report",
            paths.processReportPath,
          ];

    const result = await runPythonCommand({
      commandName: processMode === "raster_repair_v1" ? "process-raster-v1" : "process-v2",
      args: commandArgs,
      options: {
        timeoutMs: processMode === "raster_repair_v1" ? 180_000 : 90_000,
      },
    });
    if (!result.ok) {
      const isPreviewLike =
        process.env.ENABLE_JOB_DEBUG === "1" ||
        process.env.VERCEL_ENV === "preview" ||
        process.env.NODE_ENV !== "production";
      const runtimeOrDependencyIssue =
        result.stderr.toLowerCase().includes("no module named") ||
        result.stderr.toLowerCase().includes("command not found") ||
        result.stderr.toLowerCase().includes("not found") ||
        result.stderr.toLowerCase().includes("python");
      if (isPreviewLike && runtimeOrDependencyIssue) {
        await writeFile(paths.processedPdfPath, buffer);
        await getStorageAdapter().writeJson(paths.processReportPath, {
          ok: true,
          processMode: "passthrough-fallback",
          warning: "Python processor unavailable in preview; returned original PDF.",
          inputPageCount: await readPdfPageCount(inputPdfPath),
          outputPageCount: await readPdfPageCount(inputPdfPath),
        });
        effectiveProcessMode = "passthrough-fallback";
        warning = "Python processor unavailable in preview; returned original PDF.";
      } else {
        throw new Error(result.stderr || "python process failed");
      }
    }

    const processedExists = await fileExists(paths.processedPdfPath);
    if (!processedExists) {
      throw new Error("processed output missing");
    }

    if (isBlobStorageEnabled()) {
      const { put } = await import("@vercel/blob");
      const outputBytes = await readFile(paths.processedPdfPath);
      const reportBytes = await readFile(paths.processReportPath);
      const outputBlob = await put(`jobs/${jobId}/processed.pdf`, outputBytes, {
        access: "private",
        contentType: "application/pdf",
        allowOverwrite: true,
      });
      const reportBlob = await put(`jobs/${jobId}/process-report.json`, reportBytes, {
        access: "private",
        contentType: "application/json",
        allowOverwrite: true,
      });
      outputBlobUrl = outputBlob.url;
      reportBlobUrl = reportBlob.url;
    }

    try {
      const job = await readJob(jobId);
      const updated: JobRecord = {
        ...job,
        sourcePathname: sourcePathname || job.sourcePathname,
        sourceBlobUrl: sourceBlobUrl || job.sourceBlobUrl,
        status: "ready_for_download",
        processOutputPath: paths.processedPdfPath,
        processReportPath: paths.processReportPath,
        processOutputBlobUrl: outputBlobUrl ?? job.processOutputBlobUrl,
        processReportBlobUrl: reportBlobUrl ?? job.processReportBlobUrl,
        updatedAt: new Date().toISOString(),
      };
      await writeJobMetadata(updated);
      persistedJob = updated;
    } catch (error) {
      console.warn("[processJobStateless] patch job failed (continuing)", {
        jobId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    return {
      job: persistedJob,
      outputPath: paths.processedPdfPath,
      reportPath: paths.processReportPath,
      outputBlobUrl,
      reportBlobUrl,
      processMode: effectiveProcessMode,
      warning,
    };
  } finally {
    try {
      const { rm } = await import("node:fs/promises");
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

export async function prepareDownload(jobId: string): Promise<{ job: JobRecord; path: string }> {
  const job = await readJob(jobId);
  if (job.status !== "ready_for_download" && job.status !== "downloaded") {
    throw new Error(`invalid state for download: ${job.status}`);
  }
  const outputPath = job.processOutputPath ?? resolvePaths(jobId).processedPdfPath;
  if (!(await fileExists(outputPath))) {
    throw new Error("download unavailable");
  }
  const updated = await markDownloaded(jobId);
  return {
    job: updated,
    path: outputPath,
  };
}

export async function deleteStage2Job(jobId: string): Promise<void> {
  await expireJob(jobId);
  await deleteJob(jobId);
}

function buildFallbackReviewPayload(pageCount: number): JobReviewPayload {
  const safePages = Math.max(pageCount, 1);
  return {
    generatedAt: new Date().toISOString(),
    supportedCount: 0,
    unsupportedCount: 0,
    candidates: [],
    unsupportedReasons: {},
    notes: [
      "js-fallback analyzer used",
      "python analyzer unavailable in preview runtime",
    ],
    documentMode: "raster_page",
    recommendedProcessMode: "raster_repair_v1",
    watermarkRegionHint: "right_bottom",
    pageImageLikeRatio: 1,
    repeatedWatermarkPages: Array.from({ length: safePages }, (_, i) => i + 1),
    logoPositionStats: {
      rightBottom: safePages,
      rightBottomRatio: 1,
      unknown: 0,
    },
    rasterPageAnalysis: {
      pageCount: safePages,
      imageLikePageCount: safePages,
      imageLikeRatio: 1,
      repeatedBottomRightMarkPages: safePages,
      repeatedBottomRightMarkRatio: 1,
      watermarkRegionHint: "right_bottom",
      recommendedProcessMode: "raster_repair_v1",
      fullPageRasterSignalCount: safePages,
      pageImageLikeRatio: 1,
      repeatedWatermarkPages: Array.from({ length: safePages }, (_, i) => i + 1),
      logoPositionStats: {
        rightBottom: safePages,
        rightBottomRatio: 1,
        unknown: 0,
      },
    },
    qualityMetrics: {
      candidateCount: 0,
      anchorCount: 0,
      reliableAnchorCount: 0,
      reliableAnchorRate: 0,
      attemptedOperationCount: 0,
      appliedOperationCount: 0,
      noInstructionRemovedCount: 0,
      partialHitCandidateCount: 0,
      removalSuccessRate: 0,
      vectorAttemptedOperationCount: 0,
      vectorAppliedOperationCount: 0,
      vectorNoInstructionRemovedCount: 0,
      vectorRemovalSuccessRate: 0,
      vectorSpanShapeMismatchCount: 0,
      vectorGraphicsDepthMismatchCount: 0,
      vectorMissingPathSegmentCount: 0,
      vectorMissingPaintSegmentCount: 0,
      vectorRequiredPaintOperatorMissingCount: 0,
      vectorSignaturePrefixMismatchCount: 0,
      vectorSignatureOperatorSequenceMismatchCount: 0,
      vectorSignatureBBoxMismatchCount: 0,
      vectorDeleteRemovedZeroCommandsCount: 0,
      vectorResidualPathLeftCount: 0,
      vectorResidualPaintLeftCount: 0,
    },
    executionPayload: {
      pageCommandCount: 0,
    },
  };
}

async function fileExistsForScript(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isPythonBinaryAvailable(binary: "python3" | "python"): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function checkPythonDependencies(): Promise<{ ok: boolean; message?: string }> {
  return new Promise<{ ok: boolean; message?: string }>((resolve) => {
    const child = spawn(
      "python3",
      [
        "-c",
        "import pikepdf; import fitz; print('ok')",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        message: error.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        message: stderr.trim() || "Missing python dependency.",
      });
    });
  });
}

async function readExistingProcessMetrics(reportPath: string): Promise<QualityMetrics | null> {
  if (!(await getStorageAdapter().exists(reportPath))) {
    return null;
  }
  try {
    const old = await getStorageAdapter().readJson<ProcessReportV2>(reportPath);
    return old.qualityMetrics ?? null;
  } catch {
    return null;
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  if (!(await getStorageAdapter().exists(path))) {
    return null;
  }
  try {
    return await getStorageAdapter().readJson<T>(path);
  } catch {
    return null;
  }
}

async function readPdfPageCount(path: string): Promise<number> {
  const bytes = await readFile(path);
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

function resolveProcessReportPageCount(report: ProcessReportV2 | null): number | null {
  if (!report) {
    return null;
  }
  if (typeof report.outputPageCount === "number" && report.outputPageCount > 0) {
    return report.outputPageCount;
  }
  if (typeof report.processedPageCount === "number" && report.processedPageCount > 0) {
    return report.processedPageCount;
  }
  if (Array.isArray(report.perPageResults) && report.perPageResults.length > 0) {
    return report.perPageResults.length;
  }
  return null;
}

function isProcessReportComplete(report: ProcessReportV2 | null, originalPageCount: number): boolean {
  if (!report) {
    return false;
  }
  if ((report.outputPageCount ?? 0) === originalPageCount) {
    return true;
  }
  if ((report.processedPageCount ?? 0) === originalPageCount) {
    return true;
  }
  return Array.isArray(report.perPageResults) && report.perPageResults.length === originalPageCount;
}

function buildExecutionMap(
  selections: JobSelectionItem[],
  candidates: JobReviewPayload["candidates"],
): Array<{
  candidateId: string;
  page: number;
  commandStart: number;
  commandEnd: number;
  pathStart: number;
  pathEnd: number;
  paintStart: number;
  paintEnd: number;
  operatorName: string;
  operatorType: string;
  resourceName: string;
  reliability: string;
  anchorId: string;
  blockId: string;
  spanShapeSignature: string;
  paintOperators: string[];
  pathOperators: string[];
  graphicsDepth: number;
  removalStrategy: string;
}> {
  const map = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const rows: Array<{
    candidateId: string;
    page: number;
    commandStart: number;
    commandEnd: number;
    pathStart: number;
    pathEnd: number;
    paintStart: number;
    paintEnd: number;
    operatorName: string;
    operatorType: string;
    resourceName: string;
    reliability: string;
    anchorId: string;
    blockId: string;
    spanShapeSignature: string;
    paintOperators: string[];
    pathOperators: string[];
    graphicsDepth: number;
    removalStrategy: string;
  }> = [];
  for (const selection of selections) {
    const candidate = map.get(selection.candidateId);
    if (!candidate) {
      continue;
    }
    for (const anchor of candidate.anchors) {
      rows.push({
        candidateId: candidate.id,
        page: anchor.page,
        commandStart: anchor.commandStart,
        commandEnd: anchor.commandEnd,
        pathStart: anchor.pathStart ?? -1,
        pathEnd: anchor.pathEnd ?? -1,
        paintStart: anchor.paintStart ?? -1,
        paintEnd: anchor.paintEnd ?? -1,
        operatorName: anchor.operatorName,
        operatorType: anchor.operatorType,
        resourceName: anchor.resourceName,
        reliability: anchor.reliability,
        anchorId: buildAnchorId(candidate.id, anchor),
        blockId: anchor.blockId ?? "",
        spanShapeSignature: anchor.spanShapeSignature ?? "",
        paintOperators: anchor.paintOperators ?? [],
        pathOperators: anchor.pathOperators ?? [],
        graphicsDepth: anchor.graphicsDepth,
        removalStrategy: anchor.removalStrategy ?? "no_reliable_anchor",
      });
    }
  }
  return rows;
}

function buildAnchorId(
  candidateId: string,
  anchor: {
    page: number;
    commandStart: number;
    commandEnd: number;
    blockId?: string;
  },
): string {
  if (anchor.blockId && anchor.blockId.length > 0) {
    return `${candidateId}:${anchor.blockId}`;
  }
  return `${candidateId}:p${anchor.page}:${anchor.commandStart}-${anchor.commandEnd}`;
}
