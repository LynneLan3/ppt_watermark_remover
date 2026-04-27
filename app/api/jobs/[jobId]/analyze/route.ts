import { NextResponse } from "next/server";

import {
  AnalyzePhaseError,
  analyzeJobV1Stateless,
  type AnalyzeFailureCode,
  type AnalyzePhase,
} from "@/lib/jobs/service";
import { readJob } from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type AnalyzeRequest = {
  sourcePathname?: string;
  sourceBlobUrl?: string;
  fileName?: string;
  size?: number;
  contentType?: string;
};

export async function POST(request: Request, { params }: Params) {
  const startedAt = Date.now();
  const { jobId } = await params;
  const body = (await request.json().catch(() => ({}))) as AnalyzeRequest;
  const hasBodySourcePathname = Boolean(body.sourcePathname);
  const hasBodySourceBlobUrl = Boolean(body.sourceBlobUrl);

  let phase: AnalyzePhase = "resolve_source_input";
  let sourcePdfExists = false;
  let pdfBufferBytes = 0;

  let job: Awaited<ReturnType<typeof readJob>> | null = null;
  try {
    job = await readJob(jobId);
  } catch {
    job = null;
  }

  let sourcePathname = body.sourcePathname;
  let sourceBlobUrl = body.sourceBlobUrl;
  if (!sourcePathname && job?.sourcePathname) {
    sourcePathname = job.sourcePathname;
  }
  if (!sourceBlobUrl && job?.sourceBlobUrl) {
    sourceBlobUrl = job.sourceBlobUrl;
  }

  const jobManifestExists = Boolean(job);
  sourcePdfExists = Boolean(sourcePathname || sourceBlobUrl);

  if (!sourcePathname && !sourceBlobUrl) {
    const code = !jobManifestExists && !hasBodySourcePathname && !hasBodySourceBlobUrl ? "job_not_found" : "upload_not_finalized";
    return buildAnalyzeErrorResponse({
      status: code === "job_not_found" ? 404 : 409,
      code,
      phase,
      jobId,
      sourcePathname: sourcePathname ?? null,
      hasBodySourcePathname,
      hasBodySourceBlobUrl,
      jobManifestExists,
      sourcePdfExists: false,
      pdfBufferBytes: 0,
      trace: null,
      error: {
        name: code,
        message:
          code === "job_not_found"
            ? "Job not found, expired, or already deleted."
            : "Upload not finalized. Missing sourcePathname/sourceBlobUrl.",
      },
    });
  }

  try {
    const isPreviewLike =
      process.env.ENABLE_JOB_DEBUG === "1" ||
      process.env.VERCEL_ENV === "preview" ||
      process.env.NODE_ENV !== "production";
    const result = await analyzeJobV1Stateless({
      jobId,
      sourcePathname,
      sourceBlobUrl,
      enableJsFallback: isPreviewLike,
    });

    phase = "patch_job_ready_for_review";
    pdfBufferBytes = result.pdfBufferBytes;
    sourcePdfExists = true;

    return NextResponse.json({
      success: true,
      code: "ok",
      phase,
      message: "Analyze completed.",
      jobId,
      analyzer: result.analyzer,
      analyzerFallbackReason: result.analyzerFallbackReason ?? null,
      pageCount:
        typeof (result.analysisObject as { pageCount?: unknown } | null)?.pageCount === "number"
          ? ((result.analysisObject as { pageCount: number }).pageCount)
          : undefined,
      job: result.job ?? job ?? undefined,
      data: {
        review: result.review,
        analysis: result.analysisObject,
        analysisPath: result.analysisPath,
        sourcePathname: result.sourcePathname,
        hasSourceBlobUrl: Boolean(result.sourceBlobUrl),
        trace: result.trace,
        runtimeCheck: result.runtimeCheck,
      },
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const fallbackCode: AnalyzeFailureCode = "analyze_failed";
    let code: AnalyzeFailureCode = fallbackCode;
    let message = error instanceof Error ? error.message : "Analyze failed.";
    let details: Record<string, unknown> | undefined;

    if (error instanceof AnalyzePhaseError) {
      code = error.code;
      phase = error.phase;
      message = error.message;
      details = error.details;
    }

    const status = mapAnalyzeCodeToStatus(code);
    if (code === "source_pdf_not_found") {
      sourcePdfExists = false;
    }
    if (typeof details?.pdfBufferBytes === "number") {
      pdfBufferBytes = details.pdfBufferBytes;
    }

    console.error({
      level: "error",
      phase: "analyze_error",
      analyzePhase: phase,
      code,
      jobId,
      durationMs,
      error: message,
      details,
      timestamp: new Date().toISOString(),
    });

    return buildAnalyzeErrorResponse({
      status,
      code,
      phase,
      jobId,
      sourcePathname: sourcePathname ?? null,
      hasBodySourcePathname,
      hasBodySourceBlobUrl,
      jobManifestExists,
      sourcePdfExists,
      pdfBufferBytes,
      trace: Array.isArray(details?.trace) ? (details?.trace as Array<Record<string, unknown>>) : null,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message,
        exitCode: asNumberOrNull(details?.exitCode),
        signal: asStringOrNull(details?.signal),
        stderrPreview: limitText(asStringOrNull(details?.stderr), 2000),
        stdoutPreview: limitText(asStringOrNull(details?.stdout), 2000),
      },
    });
  }
}

function mapAnalyzeCodeToStatus(code: AnalyzeFailureCode): number {
  if (code === "source_pdf_not_found") return 404;
  if (code === "source_pdf_read_failed") return 500;
  if (code === "pdf_buffer_empty") return 400;
  if (code === "pdf_analyzer_runtime_missing") return 500;
  if (code === "pdf_analyzer_script_missing") return 500;
  if (code === "pdf_analyzer_dependency_missing") return 500;
  if (code === "pdf_analyzer_failed") return 500;
  if (code === "pdf_analyzer_output_invalid") return 500;
  if (code === "analysis_write_failed") return 500;
  return 500;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function limitText(value: string | null, maxLen: number): string | null {
  if (!value) return null;
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

function buildAnalyzeErrorResponse(input: {
  status: number;
  code: string;
  phase: string;
  jobId: string;
  sourcePathname: string | null;
  hasBodySourcePathname: boolean;
  hasBodySourceBlobUrl: boolean;
  jobManifestExists: boolean;
  sourcePdfExists: boolean;
  pdfBufferBytes: number;
  trace: Array<Record<string, unknown>> | null;
  error: {
    name: string;
    message: string;
    exitCode?: number | null;
    signal?: string | null;
    stderrPreview?: string | null;
    stdoutPreview?: string | null;
  };
}) {
  const includeVerbose =
    process.env.ENABLE_JOB_DEBUG === "1" || process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production";

  return NextResponse.json(
    {
      success: false,
      code: input.code,
      phase: input.phase,
      jobId: input.jobId,
      sourcePathname: input.sourcePathname,
      hasBodySourcePathname: input.hasBodySourcePathname,
      hasBodySourceBlobUrl: input.hasBodySourceBlobUrl,
      jobManifestExists: input.jobManifestExists,
      sourcePdfExists: input.sourcePdfExists,
      pdfBufferBytes: input.pdfBufferBytes,
      runtime: {
        nodeEnv: process.env.NODE_ENV || null,
        vercel: Boolean(process.env.VERCEL),
        vercelEnv: process.env.VERCEL_ENV || null,
        cwd: process.cwd(),
      },
      trace: includeVerbose ? input.trace : null,
      error: includeVerbose
        ? {
            name: input.error.name,
            message: input.error.message,
            exitCode: input.error.exitCode ?? null,
            signal: input.error.signal ?? null,
            stderrPreview: input.error.stderrPreview ?? null,
            stdoutPreview: input.error.stdoutPreview ?? null,
          }
        : {
            name: input.error.name,
            message: input.error.message,
          },
      message: input.error.message,
    },
    { status: input.status },
  );
}
