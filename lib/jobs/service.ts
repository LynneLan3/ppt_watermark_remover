import "server-only";

import { readFile, writeFile } from "node:fs/promises";

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
import { getStorageAdapter } from "@/lib/storage/local-adapter";
import { validateUploadedPdf } from "@/lib/storage/upload";

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
  await transitionJobStatus(jobId, "analyzing");
  const job = await readJob(jobId);
  if (!job.sourcePdfPath) {
    throw new Error("source pdf missing");
  }
  const paths = resolvePaths(jobId);
  const previousReview = await readReviewPayload(jobId);
  const result = await runPythonCommand({
    commandName: "analyze",
    args: [
      "engine/python/cli.py",
      "analyze",
      "--input",
      job.sourcePdfPath,
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
      job.sourcePdfPath,
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
  try {
    const job = await readJob(jobId);
    if (!job.sourcePdfPath) {
      throw new Error("source pdf missing");
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
      sourcePdfPath: job.sourcePdfPath,
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
            job.sourcePdfPath,
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
            job.sourcePdfPath,
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
    const originalPageCount = await readPdfPageCount(job.sourcePdfPath);
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
