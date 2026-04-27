import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument } from "pdf-lib";

export type ManualReviewStatus = "uploaded" | "processing" | "completed" | "failed";

export type ManualReviewJobRecord = {
  jobId: string;
  status: ManualReviewStatus;
  currentStage: "uploaded" | "processing" | "completed" | "failed";
  algorithmProfile: string;
  enableSeamMicroPolish: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pageCount: number | null;
  originalFilename: string;
  fileSizeBytes: number;
  errorSummary?: string;
  logsRelativePath: string;
  paths: {
    jobDir: string;
    originalPdfPath: string;
    processedPdfPath: string;
    processReportPath: string;
    processRequestPath: string;
    processDebugPath: string;
    logsPath: string;
  };
};

export type ManualReviewDebugArtifact = {
  name: string;
  relativePath: string;
  url: string;
};

export type ManualReviewJobResponse = {
  jobId: string;
  status: ManualReviewStatus;
  currentStage: ManualReviewJobRecord["currentStage"];
  elapsedMs: number;
  algorithmProfile: string;
  enableSeamMicroPolish: boolean;
  originalFilename: string;
  fileSizeBytes: number;
  pageCount: number | null;
  errorSummary?: string;
  logsRelativePath: string;
  urls: {
    originalUrl: string;
    processedUrl: string;
    reportUrl: string;
    logsUrl: string;
  };
  debugArtifacts: ManualReviewDebugArtifact[];
};

export type ManualQaStatus =
  | "Pass"
  | "Minor Residue"
  | "Visible Residue"
  | "White Patch"
  | "Hard Edge"
  | "Text / Line Damage"
  | "Severe Fail";

export type ManualQaPageReviewPayload = {
  pageIndex: number;
  manualStatus: ManualQaStatus;
  issueTags: string[];
  note?: string;
};

export type ManualQaPageArtifactPayload = {
  pageIndex: number;
  originalPageScreenshotDataUrl: string;
  processedPageScreenshotDataUrl: string;
  originalBottomRightCropDataUrl: string;
  processedBottomRightCropDataUrl: string;
};

export type ManualQaDatasetRow = {
  jobId: string;
  pdfName: string;
  pageIndex: number;
  manualStatus: ManualQaStatus;
  issueTags: string[];
  note: string;
  algorithmProfile: string;
  processReportPerPage: Record<string, unknown> | null;
};

export type ManualQaSummary = {
  totalPages: number;
  passCount: number;
  failCount: number;
  passRate: number;
  residueCount: number;
  whitePatchCount: number;
  hardEdgeCount: number;
  damageCount: number;
  severeFailCount: number;
  overallPassRate: number;
  issueDistribution: Record<string, number>;
  failedPages: Array<{
    pageIndex: number;
    manualStatus: ManualQaStatus;
    issueTags: string[];
    note: string;
  }>;
  topIssueType: string;
  recommendedNextOptimizationTarget: string;
};

const DEFAULT_ALGORITHM_PROFILE = "stable-light-complex-v5";
const JOB_TIMEOUT_MS = 10 * 60_000;

export function isManualReviewEnabled(): boolean {
  return process.env.ENABLE_MANUAL_REVIEW === "true";
}

export function getManualReviewTmpDir(): string {
  return path.resolve(process.cwd(), process.env.MANUAL_REVIEW_TMP_DIR || "tmp/manual-review");
}

export function getManualReviewAlgorithmProfile(): string {
  return process.env.WATERMARK_ALGORITHM_PROFILE || DEFAULT_ALGORITHM_PROFILE;
}

export function getManualReviewMicroPolishEnabled(): boolean {
  return false;
}

export async function createManualReviewJob(params: {
  originalFilename: string;
  fileBytes: Buffer;
}): Promise<ManualReviewJobRecord> {
  const jobId = generateManualReviewJobId();
  const root = getManualReviewTmpDir();
  const jobDir = path.join(root, jobId);
  const originalPdfPath = path.join(jobDir, "original.pdf");
  const processedPdfPath = path.join(jobDir, "processed.pdf");
  const processReportPath = path.join(jobDir, "process-report.json");
  const processRequestPath = path.join(jobDir, "request.json");
  const processDebugPath = path.join(jobDir, "process-debug.v1.json");
  const logsPath = path.join(jobDir, "logs.txt");
  const logsRelativePath = path.join(path.relative(process.cwd(), jobDir), "logs.txt");

  await mkdir(jobDir, { recursive: true });
  await writeFile(originalPdfPath, params.fileBytes);

  const nowIso = new Date().toISOString();
  const pageCount = await safeParsePdfPageCount(params.fileBytes);
  const algorithmProfile = getManualReviewAlgorithmProfile();
  const enableSeamMicroPolish = getManualReviewMicroPolishEnabled();

  const job: ManualReviewJobRecord = {
    jobId,
    status: "uploaded",
    currentStage: "uploaded",
    algorithmProfile,
    enableSeamMicroPolish,
    createdAt: nowIso,
    pageCount,
    originalFilename: params.originalFilename,
    fileSizeBytes: params.fileBytes.length,
    logsRelativePath,
    paths: {
      jobDir,
      originalPdfPath,
      processedPdfPath,
      processReportPath,
      processRequestPath,
      processDebugPath,
      logsPath,
    },
  };

  await writeJobRecord(job);
  void startManualReviewProcessing(jobId);
  return job;
}

export async function readManualReviewJob(jobId: string): Promise<ManualReviewJobRecord> {
  const metadataPath = getMetadataPath(jobId);
  const raw = await readFile(metadataPath, "utf-8");
  return JSON.parse(raw) as ManualReviewJobRecord;
}

export async function getManualReviewJobResponse(jobId: string): Promise<ManualReviewJobResponse> {
  const job = await readManualReviewJob(jobId);
  const elapsedMs = computeElapsedMs(job);
  const basePath = `/api/manual-review/jobs/${encodeURIComponent(jobId)}`;
  const debugArtifacts = await collectDebugArtifacts(job);

  return {
    jobId: job.jobId,
    status: job.status,
    currentStage: job.currentStage,
    elapsedMs,
    algorithmProfile: job.algorithmProfile,
    enableSeamMicroPolish: job.enableSeamMicroPolish,
    originalFilename: job.originalFilename,
    fileSizeBytes: job.fileSizeBytes,
    pageCount: job.pageCount,
    errorSummary: job.errorSummary,
    logsRelativePath: job.logsRelativePath,
    urls: {
      originalUrl: `${basePath}/original.pdf`,
      processedUrl: `${basePath}/processed.pdf`,
      reportUrl: `${basePath}/process-report.json`,
      logsUrl: `${basePath}/logs.txt`,
    },
    debugArtifacts,
  };
}

export async function resolveArtifactPath(params: {
  jobId: string;
  artifact: "original.pdf" | "processed.pdf" | "process-report.json" | "logs.txt";
}): Promise<string> {
  const job = await readManualReviewJob(params.jobId);
  if (params.artifact === "original.pdf") {
    return job.paths.originalPdfPath;
  }
  if (params.artifact === "processed.pdf") {
    return job.paths.processedPdfPath;
  }
  if (params.artifact === "process-report.json") {
    return job.paths.processReportPath;
  }
  return job.paths.logsPath;
}

export async function resolveDebugArtifactPath(params: {
  jobId: string;
  artifactPath: string[];
}): Promise<string> {
  const job = await readManualReviewJob(params.jobId);
  const normalized = path.normalize(path.join(...params.artifactPath));
  const target = path.resolve(job.paths.jobDir, normalized);
  const jobRoot = path.resolve(job.paths.jobDir);
  if (!target.startsWith(jobRoot)) {
    throw new Error("invalid debug artifact path");
  }
  return target;
}

export async function saveManualQaPageArtifacts(
  jobId: string,
  payload: ManualQaPageArtifactPayload,
): Promise<{ pageDir: string; files: string[] }> {
  const job = await readManualReviewJob(jobId);
  const pageDir = path.join(getQaRootDir(job), `page-${payload.pageIndex}`);
  await mkdir(pageDir, { recursive: true });

  const writes: Array<Promise<void>> = [
    writeDataUrlToFile(payload.originalPageScreenshotDataUrl, path.join(pageDir, "original-page.png")),
    writeDataUrlToFile(payload.processedPageScreenshotDataUrl, path.join(pageDir, "processed-page.png")),
    writeDataUrlToFile(payload.originalBottomRightCropDataUrl, path.join(pageDir, "bottom-right-original-crop.png")),
    writeDataUrlToFile(payload.processedBottomRightCropDataUrl, path.join(pageDir, "bottom-right-processed-crop.png")),
  ];
  await Promise.all(writes);

  const report = await readProcessReport(job);
  const perPage = report.perPageByIndex.get(payload.pageIndex) ?? null;
  await copyPageDebugArtifacts(job, payload.pageIndex, perPage, pageDir);

  const names = await readdir(pageDir);
  return {
    pageDir,
    files: names.sort(),
  };
}

export async function buildAndWriteManualQaSummary(params: {
  jobId: string;
  pdfName: string;
  algorithmProfile: string;
  pageReviews: ManualQaPageReviewPayload[];
}): Promise<{
  qaDatasetPath: string;
  qaSummaryPath: string;
  qaDatasetUrl: string;
  qaSummaryUrl: string;
  summary: ManualQaSummary;
}> {
  const job = await readManualReviewJob(params.jobId);
  const report = await readProcessReport(job);
  const totalPages =
    report.totalPages > 0
      ? report.totalPages
      : job.pageCount && job.pageCount > 0
        ? job.pageCount
        : Math.max(...params.pageReviews.map((row) => row.pageIndex), 1);

  const reviewMap = new Map<number, ManualQaPageReviewPayload>();
  for (const review of params.pageReviews) {
    if (!Number.isInteger(review.pageIndex) || review.pageIndex <= 0) {
      continue;
    }
    reviewMap.set(review.pageIndex, {
      pageIndex: review.pageIndex,
      manualStatus: review.manualStatus,
      issueTags: sanitizeIssueTags(review.issueTags),
      note: review.note?.trim() || "",
    });
  }

  const datasetRows: ManualQaDatasetRow[] = [];
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    const review = reviewMap.get(pageIndex) ?? {
      pageIndex,
      manualStatus: "Pass" as const,
      issueTags: [],
      note: "",
    };
    datasetRows.push({
      jobId: job.jobId,
      pdfName: params.pdfName,
      pageIndex,
      manualStatus: review.manualStatus,
      issueTags: sanitizeIssueTags(review.issueTags),
      note: review.note?.trim() || "",
      algorithmProfile: params.algorithmProfile || job.algorithmProfile,
      processReportPerPage: report.perPageByIndex.get(pageIndex) ?? null,
    });
  }

  const summary = buildQaSummary(datasetRows);
  const qaRootDir = getQaRootDir(job);
  await mkdir(qaRootDir, { recursive: true });
  const qaDatasetPath = path.join(qaRootDir, "qa-dataset.json");
  const qaSummaryPath = path.join(qaRootDir, "qa-summary.json");

  const datasetPayload = {
    exportedAt: new Date().toISOString(),
    jobId: job.jobId,
    pdfName: params.pdfName,
    algorithmProfile: params.algorithmProfile || job.algorithmProfile,
    rows: datasetRows,
  };
  await writeFile(qaDatasetPath, JSON.stringify(datasetPayload, null, 2), "utf-8");
  await writeFile(
    qaSummaryPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        jobId: job.jobId,
        pdfName: params.pdfName,
        algorithmProfile: params.algorithmProfile || job.algorithmProfile,
        ...summary,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const base = `/api/manual-review/jobs/${encodeURIComponent(job.jobId)}`;
  return {
    qaDatasetPath,
    qaSummaryPath,
    qaDatasetUrl: `${base}/qa-dataset.json`,
    qaSummaryUrl: `${base}/qa-summary.json`,
    summary,
  };
}

export async function resolveQaExportPath(params: {
  jobId: string;
  artifact: "qa-dataset.json" | "qa-summary.json";
}): Promise<string> {
  const job = await readManualReviewJob(params.jobId);
  return path.join(getQaRootDir(job), params.artifact);
}

async function startManualReviewProcessing(jobId: string): Promise<void> {
  let job: ManualReviewJobRecord;
  try {
    job = await readManualReviewJob(jobId);
  } catch {
    return;
  }

  const processingStartedAt = new Date().toISOString();
  const nextJob: ManualReviewJobRecord = {
    ...job,
    status: "processing",
    currentStage: "processing",
    startedAt: processingStartedAt,
    errorSummary: undefined,
  };
  await writeJobRecord(nextJob);

  const requestPayload = {
    jobId,
    processMode: "raster_repair_v1",
    algorithmProfile: nextJob.algorithmProfile,
    processDebugPath: nextJob.paths.processDebugPath,
    selection: [],
    previousMetrics: null,
    rasterProcessConfig: {
      watermarkRegionHint: "right_bottom",
      roi: {
        widthRatio: 0.16,
        heightRatio: 0.08,
      },
      renderScale: 2.5,
      enableSeamMicroPolish: nextJob.enableSeamMicroPolish,
      algorithmProfile: nextJob.algorithmProfile,
    },
  };

  await writeFile(nextJob.paths.processRequestPath, JSON.stringify(requestPayload, null, 2), "utf-8");

  const args = [
    "python/process_raster_watermark_v1.py",
    "--request",
    nextJob.paths.processRequestPath,
    "--input",
    nextJob.paths.originalPdfPath,
    "--output",
    nextJob.paths.processedPdfPath,
    "--report",
    nextJob.paths.processReportPath,
  ];

  const outcome = await runPythonWithLogs(args, nextJob.paths.logsPath);
  const finishedAt = new Date().toISOString();
  const outputReady = await isFileReady(nextJob.paths.processedPdfPath);
  const reportReady = await isFileReady(nextJob.paths.processReportPath);

  if (outcome.ok && outputReady && reportReady) {
    const completed: ManualReviewJobRecord = {
      ...nextJob,
      status: "completed",
      currentStage: "completed",
      completedAt: finishedAt,
    };
    await writeJobRecord(completed);
    return;
  }

  const failed: ManualReviewJobRecord = {
    ...nextJob,
    status: "failed",
    currentStage: "failed",
    completedAt: finishedAt,
    errorSummary: outcome.errorSummary || "python processing failed",
  };
  await writeJobRecord(failed);
}

function getQaRootDir(job: ManualReviewJobRecord): string {
  return path.join(job.paths.jobDir, "qa");
}

function generateManualReviewJobId(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
    now.getSeconds().toString().padStart(2, "0"),
  ].join("");
  const random = randomBytes(3).toString("hex");
  return `${stamp}-${random}`;
}

function getMetadataPath(jobId: string): string {
  return path.join(getManualReviewTmpDir(), jobId, "job.json");
}

async function writeJobRecord(job: ManualReviewJobRecord): Promise<void> {
  await mkdir(job.paths.jobDir, { recursive: true });
  await writeFile(getMetadataPath(job.jobId), JSON.stringify(job, null, 2), "utf-8");
}

function computeElapsedMs(job: ManualReviewJobRecord): number {
  const startMs = Date.parse(job.startedAt || job.createdAt);
  const endMs = Date.parse(job.completedAt || new Date().toISOString());
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return endMs - startMs;
}

async function safeParsePdfPageCount(fileBytes: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

async function runPythonWithLogs(
  args: string[],
  logsPath: string,
): Promise<{ ok: boolean; errorSummary: string | null }> {
  return new Promise((resolve) => {
    const child = spawn("python3", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
    }, JOB_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", async (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      await writeRunLogs(logsPath, {
        args,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
      resolve({ ok: false, errorSummary: error.message });
    });

    child.on("close", async (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      await writeRunLogs(logsPath, {
        args,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
      const ok = exitCode === 0 && !timedOut;
      if (ok) {
        resolve({ ok: true, errorSummary: null });
        return;
      }
      const baseError = timedOut
        ? `python process timed out after ${JOB_TIMEOUT_MS}ms`
        : `python process exited with code ${String(exitCode)}`;
      const stderrSummary = stderr.trim().slice(0, 500);
      resolve({ ok: false, errorSummary: stderrSummary ? `${baseError}: ${stderrSummary}` : baseError });
    });
  });
}

async function writeRunLogs(
  logsPath: string,
  params: {
    args: string[];
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  },
): Promise<void> {
  const lines = [
    `timestamp=${new Date().toISOString()}`,
    `cwd=${process.cwd()}`,
    `command=python3 ${params.args.join(" ")}`,
    `durationMs=${params.durationMs}`,
    `timedOut=${params.timedOut ? "1" : "0"}`,
    "",
    "[stdout]",
    params.stdout || "",
    "",
    "[stderr]",
    params.stderr || "",
    "",
  ];
  await writeFile(logsPath, lines.join("\n"), "utf-8");
}

async function collectDebugArtifacts(job: ManualReviewJobRecord): Promise<ManualReviewDebugArtifact[]> {
  const fromReport = await collectDebugArtifactsFromReport(job);
  const overlays = await collectOverlayImages(job);
  const deduped = dedupeArtifacts([...fromReport, ...overlays]);

  return deduped.map((entry) => ({
    name: path.basename(entry.relativePath),
    relativePath: entry.relativePath,
    url: toDebugArtifactUrl(job.jobId, entry.relativePath),
  }));
}

async function collectDebugArtifactsFromReport(
  job: ManualReviewJobRecord,
): Promise<Array<{ relativePath: string }>> {
  if (!(await isFileReady(job.paths.processReportPath))) {
    return [];
  }

  let report: unknown;
  try {
    const raw = await readFile(job.paths.processReportPath, "utf-8");
    report = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!report || typeof report !== "object") {
    return [];
  }

  const rows = Array.isArray((report as { perPageResults?: unknown[] }).perPageResults)
    ? (report as { perPageResults: unknown[] }).perPageResults
    : [];

  const entries: Array<{ relativePath: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const debugArtifacts = (row as { debugArtifacts?: unknown }).debugArtifacts;
    if (!debugArtifacts || typeof debugArtifacts !== "object") {
      continue;
    }
    for (const value of Object.values(debugArtifacts as Record<string, unknown>)) {
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      const resolved = path.resolve(value);
      const relativePath = path.relative(job.paths.jobDir, resolved);
      if (!relativePath || relativePath.startsWith("..")) {
        continue;
      }
      if (await isFileReady(resolved)) {
        entries.push({ relativePath });
      }
    }
  }

  return entries;
}

async function collectOverlayImages(
  job: ManualReviewJobRecord,
): Promise<Array<{ relativePath: string }>> {
  const overlayDir = path.join(job.paths.jobDir, "raster-debug-overlays");
  if (!(await isDirectory(overlayDir))) {
    return [];
  }

  const names = await readdir(overlayDir);
  const rows: Array<{ relativePath: string }> = [];
  for (const name of names) {
    const absolute = path.join(overlayDir, name);
    if (!(await isFileReady(absolute))) {
      continue;
    }
    rows.push({ relativePath: path.relative(job.paths.jobDir, absolute) });
  }
  return rows;
}

async function readProcessReport(job: ManualReviewJobRecord): Promise<{
  totalPages: number;
  perPageByIndex: Map<number, Record<string, unknown>>;
}> {
  if (!(await isFileReady(job.paths.processReportPath))) {
    return {
      totalPages: 0,
      perPageByIndex: new Map(),
    };
  }
  try {
    const raw = await readFile(job.paths.processReportPath, "utf-8");
    const payload = JSON.parse(raw) as {
      inputPageCount?: number;
      processedPageCount?: number;
      perPageResults?: unknown[];
    };
    const rows = Array.isArray(payload.perPageResults) ? payload.perPageResults : [];
    const perPageByIndex = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const page = Number((row as { page?: number }).page);
      if (!Number.isInteger(page) || page <= 0) {
        continue;
      }
      perPageByIndex.set(page, row as Record<string, unknown>);
    }
    return {
      totalPages: Math.max(Number(payload.inputPageCount || 0), Number(payload.processedPageCount || 0), rows.length),
      perPageByIndex,
    };
  } catch {
    return {
      totalPages: 0,
      perPageByIndex: new Map(),
    };
  }
}

async function writeDataUrlToFile(dataUrl: string, targetPath: string): Promise<void> {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(dataUrl);
  if (!match?.[1]) {
    throw new Error(`invalid data url for ${path.basename(targetPath)}`);
  }
  const content = Buffer.from(match[1], "base64");
  await writeFile(targetPath, content);
}

async function copyPageDebugArtifacts(
  job: ManualReviewJobRecord,
  pageIndex: number,
  perPage: Record<string, unknown> | null,
  pageDir: string,
): Promise<void> {
  const sources = new Set<string>();
  const pagePrefix = `page-${String(pageIndex).padStart(3, "0")}-`;
  const overlayDir = path.join(job.paths.jobDir, "raster-debug-overlays");
  if (await isDirectory(overlayDir)) {
    const names = await readdir(overlayDir);
    for (const name of names) {
      if (!name.startsWith(pagePrefix)) {
        continue;
      }
      const absolute = path.join(overlayDir, name);
      if (await isFileReady(absolute)) {
        sources.add(absolute);
      }
    }
  }

  const debugArtifacts = perPage?.debugArtifacts;
  if (debugArtifacts && typeof debugArtifacts === "object") {
    for (const value of Object.values(debugArtifacts as Record<string, unknown>)) {
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      const absolute = path.resolve(value);
      if (await isFileReady(absolute)) {
        sources.add(absolute);
      }
    }
  }

  let cursor = 1;
  for (const sourcePath of sources) {
    const base = path.basename(sourcePath);
    let targetName = base;
    let targetPath = path.join(pageDir, targetName);
    while (await isFileReady(targetPath)) {
      targetName = `${cursor}-${base}`;
      targetPath = path.join(pageDir, targetName);
      cursor += 1;
    }
    const content = await readFile(sourcePath);
    await writeFile(targetPath, content);
  }
}

function sanitizeIssueTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    if (!tag || typeof tag !== "string") {
      continue;
    }
    out.add(tag.trim().toLowerCase());
  }
  return [...out];
}

function buildQaSummary(rows: ManualQaDatasetRow[]): ManualQaSummary {
  const totalPages = rows.length;
  const failedRows = rows.filter((row) => row.manualStatus !== "Pass");
  const passCount = totalPages - failedRows.length;
  const failCount = failedRows.length;
  const passRate = totalPages > 0 ? round4(passCount / totalPages) : 0;

  const residueCount = rows.filter(
    (row) =>
      row.manualStatus === "Minor Residue" ||
      row.manualStatus === "Visible Residue" ||
      row.issueTags.includes("minor_residue") ||
      row.issueTags.includes("visible_residue"),
  ).length;
  const whitePatchCount = rows.filter(
    (row) => row.manualStatus === "White Patch" || row.issueTags.includes("white_patch"),
  ).length;
  const hardEdgeCount = rows.filter(
    (row) => row.manualStatus === "Hard Edge" || row.issueTags.includes("hard_edge"),
  ).length;
  const damageCount = rows.filter(
    (row) => row.manualStatus === "Text / Line Damage" || row.issueTags.includes("text_line_damage"),
  ).length;
  const severeFailCount = rows.filter(
    (row) => row.manualStatus === "Severe Fail" || row.issueTags.includes("severe_fail"),
  ).length;

  const issueDistribution: Record<string, number> = {
    minor_residue: rows.filter((row) => row.manualStatus === "Minor Residue" || row.issueTags.includes("minor_residue")).length,
    visible_residue: rows.filter((row) => row.manualStatus === "Visible Residue" || row.issueTags.includes("visible_residue")).length,
    white_patch: whitePatchCount,
    hard_edge: hardEdgeCount,
    text_line_damage: damageCount,
    severe_fail: severeFailCount,
  };

  const topIssueType = pickTopIssue(issueDistribution);
  return {
    totalPages,
    passCount,
    failCount,
    passRate,
    residueCount,
    whitePatchCount,
    hardEdgeCount,
    damageCount,
    severeFailCount,
    overallPassRate: passRate,
    issueDistribution,
    failedPages: failedRows.map((row) => ({
      pageIndex: row.pageIndex,
      manualStatus: row.manualStatus,
      issueTags: row.issueTags,
      note: row.note,
    })),
    topIssueType,
    recommendedNextOptimizationTarget: recommendationForIssue(topIssueType),
  };
}

function pickTopIssue(distribution: Record<string, number>): string {
  const entries = Object.entries(distribution);
  if (entries.length <= 0) {
    return "none";
  }
  entries.sort((a, b) => b[1] - a[1]);
  if ((entries[0]?.[1] ?? 0) <= 0) {
    return "none";
  }
  return entries[0]![0];
}

function recommendationForIssue(topIssueType: string): string {
  if (topIssueType === "minor_residue" || topIssueType === "visible_residue") {
    return "Prioritize residual suppression for right-bottom small text/logo remnants.";
  }
  if (topIssueType === "white_patch") {
    return "Prioritize white patch blending and local brightness consistency near repaired region.";
  }
  if (topIssueType === "hard_edge") {
    return "Prioritize seam softening and edge transition continuity around repair mask boundaries.";
  }
  if (topIssueType === "text_line_damage") {
    return "Prioritize structure protection to reduce accidental text/line damage during cleanup.";
  }
  if (topIssueType === "severe_fail") {
    return "Prioritize fail-safe candidate gating for severe pages before micro-level tuning.";
  }
  return "No dominant issue detected. Validate with more samples before choosing optimization target.";
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function dedupeArtifacts(
  input: Array<{ relativePath: string }>,
): Array<{ relativePath: string }> {
  const seen = new Set<string>();
  const output: Array<{ relativePath: string }> = [];
  for (const row of input) {
    if (seen.has(row.relativePath)) {
      continue;
    }
    seen.add(row.relativePath);
    output.push(row);
  }
  return output;
}

function toDebugArtifactUrl(jobId: string, relativePath: string): string {
  const parts = relativePath
    .split(path.sep)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  return `/api/manual-review/jobs/${encodeURIComponent(jobId)}/debug/${parts.join("/")}`;
}

async function isFileReady(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const info = await stat(dirPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}
