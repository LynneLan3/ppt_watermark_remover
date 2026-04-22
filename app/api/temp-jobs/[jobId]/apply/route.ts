import { apiError, apiOk } from "@/lib/server/api/responses";
import { classifyApiError } from "@/lib/server/api/classify-error";
import { classifyRunnerFailure, toInternalErrorMessage } from "@/lib/server/errors/classify";
import { applyJob, readJobAnalysis, readJobReport } from "@/lib/server/jobs/service";
import { readJobMetadata } from "@/lib/server/jobs/repository";
import { buildObjectRemovalPlan } from "@/lib/local/pdf/removal-plan";
import type {
  CleanupScope,
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
} from "@/lib/local/pdf/types";
import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

type ApplyPayload = {
  selectedCandidateId: string;
  scope: CleanupScope;
  currentPage: number;
  pageCount: number;
  rangeStart?: number;
  rangeEnd?: number;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const payload = (await request.json()) as ApplyPayload;
    const validationError = validateApplyPayload(payload);
    if (validationError) {
      return apiError({
        httpStatus: 400,
        code: "validation_error",
        message: validationError,
      });
    }

    const job = await readJobMetadata(jobId);
    const rawAnalysis = (await readJobAnalysis(jobId)) as PythonAnalysisResponse;
    const analysis = normalizeAnalysis(rawAnalysis);
    const candidate = findCandidateById(analysis, payload.selectedCandidateId);
    if (!candidate) {
      return apiError({
        httpStatus: 400,
        status: job.status,
        code: "validation_error",
        message: "Selected candidate does not exist in analysis result.",
        job,
      });
    }
    if (candidate.removability !== "supported") {
      return apiError({
        httpStatus: 422,
        status: job.status,
        code: "unsupported_structure",
        message: "Selected candidate is not in supported removability state.",
        job,
      });
    }

    const plan = buildObjectRemovalPlan({
      fileName: job.originalFilename,
      candidate,
      analysisResult: analysis,
      scope: payload.scope,
      currentPage: payload.currentPage,
      pageCount: payload.pageCount,
      rangeStart: payload.rangeStart,
      rangeEnd: payload.rangeEnd,
    });

    const result = await applyJob({
      jobId,
      planJson: JSON.stringify(plan),
    });

    if (!result.runner.ok) {
      const classified = classifyRunnerFailure(result.runner);
      return apiError({
        httpStatus: toHttpStatus(classified.code),
        status: result.job.status,
        code: classified.code,
        message: classified.message,
        job: result.job,
      });
    }

    return apiOk({
      status: result.job.status,
      message: "Apply completed successfully.",
      job: result.job,
      data: {
        report: await readJobReport(jobId),
      },
    });
  } catch (error) {
    const classified = classifyApiError(error);
    return apiError({
      httpStatus: classified.httpStatus,
      code: classified.code,
      message: classified.message || toInternalErrorMessage(error),
    });
  }
}

type PythonAnalysisResponse = {
  totalCandidates: number;
  unsupportedPages: number[];
  notes: string[];
  candidatesByPage: Record<string, PdfObjectCandidate[]>;
};

function normalizeAnalysis(input: PythonAnalysisResponse): PdfCandidateAnalysisResult {
  const candidatesByPage: Record<number, PdfObjectCandidate[]> = {};
  for (const [page, candidates] of Object.entries(input.candidatesByPage ?? {})) {
    candidatesByPage[Number(page)] = candidates;
  }
  return {
    candidatesByPage,
    totalCandidates: input.totalCandidates ?? 0,
    unsupportedPages: input.unsupportedPages ?? [],
    notes: input.notes ?? [],
  };
}

function findCandidateById(
  analysis: PdfCandidateAnalysisResult,
  candidateId: string,
): PdfObjectCandidate | null {
  for (const candidates of Object.values(analysis.candidatesByPage)) {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function validateApplyPayload(payload: ApplyPayload): string | null {
  if (!payload?.selectedCandidateId) {
    return "selectedCandidateId is required";
  }
  if (!payload.scope || !["current", "all", "range"].includes(payload.scope)) {
    return "scope must be one of current, all, or range";
  }
  if (!Number.isInteger(payload.currentPage) || payload.currentPage < 1) {
    return "currentPage must be a positive integer";
  }
  if (!Number.isInteger(payload.pageCount) || payload.pageCount < 1) {
    return "pageCount must be a positive integer";
  }
  if (payload.scope === "range") {
    if (!Number.isInteger(payload.rangeStart) || !Number.isInteger(payload.rangeEnd)) {
      return "rangeStart and rangeEnd are required for range scope";
    }
    if ((payload.rangeStart ?? 0) > (payload.rangeEnd ?? 0)) {
      return "rangeStart cannot be greater than rangeEnd";
    }
  }
  return null;
}

function toHttpStatus(code: TempJobErrorCode): number {
  if (code === "runner_timeout") {
    return 504;
  }
  if (code === "unsupported_structure" || code === "no_candidates") {
    return 422;
  }
  return 500;
}
