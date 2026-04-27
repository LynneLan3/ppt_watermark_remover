import { NextResponse } from "next/server";

import { processJob, processJobStateless } from "@/lib/jobs/service";
import { readJob } from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type ProcessRequest = {
  processMode?: "object_level_v2" | "raster_repair_v1";
  sourcePathname?: string;
  sourceBlobUrl?: string;
  analysisPath?: string;
  analysis?: Record<string, unknown>;
};

export async function POST(request: Request, { params }: Params) {
  const startedAt = Date.now();
  const { jobId } = await params;
  const body = (await request.json().catch(() => ({}))) as ProcessRequest;
  const debugMode = process.env.ENABLE_JOB_DEBUG === "1" || process.env.VERCEL_ENV === "preview";
  const processMode = body.processMode === "object_level_v2" || body.processMode === "raster_repair_v1" ? body.processMode : undefined;

  const hasBodySourcePathname = Boolean(body.sourcePathname);
  let jobManifestExists = false;
  let jobSourcePathname: string | undefined;
  let sourceBlobUrlFromJob: string | undefined;
  let jobStatus: string | null = null;
  try {
    const job = await readJob(jobId);
    jobManifestExists = true;
    jobSourcePathname = job.sourcePathname;
    sourceBlobUrlFromJob = job.sourceBlobUrl;
    jobStatus = job.status;
  } catch {
    jobManifestExists = false;
  }

  const sourcePathname = body.sourcePathname || jobSourcePathname;
  const sourceBlobUrl = body.sourceBlobUrl || sourceBlobUrlFromJob;
  const hasJobSourcePathname = Boolean(jobSourcePathname);

  if (!sourcePathname && !sourceBlobUrl) {
    return NextResponse.json(
      {
        success: false,
        code: "process_source_missing",
        phase: "resolve_source_input",
        jobId,
        sourcePathname: null,
        processedPathname: `jobs/${jobId}/processed.pdf`,
        hasBodySourcePathname,
        hasJobSourcePathname,
        jobManifestExists,
        sourcePdfExists: false,
        processedPdfExists: false,
        processMode: "unknown",
        error: {
          name: "ProcessSourceMissingError",
          message: "Missing sourcePathname/sourceBlobUrl for process.",
          stdoutPreview: null,
          stderrPreview: null,
          exitCode: null,
        },
        message: "Missing process source input.",
      },
      { status: 409 },
    );
  }

  try {
    if (!body.sourcePathname && !body.sourceBlobUrl && jobManifestExists) {
      // Backward-compatible manifest-driven path.
      const legacy = await processJob(jobId, { processMode });
      return NextResponse.json({
        success: true,
        jobId,
        status: legacy.status,
        processedPathname: legacy.processedPathname ?? `jobs/${jobId}/processed.pdf`,
        processedBlobUrl: legacy.processedBlobUrl ?? legacy.processOutputBlobUrl ?? null,
        processedSize: legacy.processedSize ?? null,
        processedContentType: legacy.processedContentType ?? "application/pdf",
        processMode: legacy.processMode ?? "python",
      });
    }

    const result = await processJobStateless({
      jobId,
      processMode,
      sourcePathname,
      sourceBlobUrl,
      analysisPath: body.analysisPath,
      analysis: body.analysis,
    });

    const responsePayload = {
      success: true,
      jobId,
      status: "ready_for_download" as const,
      processedPathname: result.processedPathname,
      processedBlobUrl: result.processedBlobUrl,
      processedSize: result.processedSize,
      processedContentType: result.processedContentType,
      processMode: result.processMode,
      warning: result.warning ?? null,
    };
    return NextResponse.json(responsePayload);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Process failed.";
    const lower = rawMessage.toLowerCase();
    let code = "process_failed";
    let phase = "run_processor";
    if (lower.startsWith("processed_pdf_write_failed")) {
      code = "processed_pdf_write_failed";
      phase = "write_processed_output";
    } else if (lower.startsWith("processed_pdf_verify_failed")) {
      code = "processed_pdf_verify_failed";
      phase = "verify_processed_output";
    } else if (lower.startsWith("pdf_processor_dependency_missing")) {
      code = "pdf_processor_dependency_missing";
      phase = "run_pdf_processor";
    } else if (lower.startsWith("pdf_processor_failed")) {
      code = "pdf_processor_failed";
      phase = "run_pdf_processor";
    } else if (lower.includes("source pdf not found")) {
      code = "source_pdf_not_found";
      phase = "read_source_pdf";
    } else if (lower.includes("failed to read source pdf")) {
      code = "source_pdf_read_failed";
      phase = "read_source_pdf";
    } else if (lower.includes("processed_output_missing") || lower.includes("processed output missing")) {
      code = "processed_pdf_verify_failed";
      phase = "verify_processed_output";
    }

    const status = code === "source_pdf_not_found" ? 404 : 500;
    const includeVerbose = debugMode || process.env.NODE_ENV !== "production";
    return NextResponse.json(
      {
        success: false,
        code,
        phase,
        jobId,
        sourcePathname: sourcePathname ?? null,
        processedPathname: `jobs/${jobId}/processed.pdf`,
        hasBodySourcePathname,
        hasJobSourcePathname,
        jobManifestExists,
        sourcePdfExists: true,
        processedPdfExists: false,
        processMode: "unknown",
        runtime: {
          nodeEnv: process.env.NODE_ENV || null,
          vercel: Boolean(process.env.VERCEL),
          vercelEnv: process.env.VERCEL_ENV || null,
          cwd: process.cwd(),
          jobStatus,
        },
        error: includeVerbose
          ? {
              name: error instanceof Error ? error.name : "Error",
              message: rawMessage,
              stdoutPreview: null,
              stderrPreview: rawMessage.slice(0, 2000),
              exitCode: null,
            }
          : {
              name: error instanceof Error ? error.name : "Error",
              message: rawMessage,
            },
        message: rawMessage,
        durationMs: Date.now() - startedAt,
      },
      { status },
    );
  }
}
