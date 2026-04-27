import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { saveJobSelection } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type SelectionRequest = {
  selections?: Array<{
    candidateId?: string;
    applyMode?: "current_page" | "all_repeated" | "page_range";
    explicitPages?: number[];
  }>;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const body = (await request.json()) as SelectionRequest;
    const items = (body.selections ?? [])
      .map((item) => ({
        candidateId: typeof item.candidateId === "string" ? item.candidateId.trim() : "",
        applyMode:
          item.applyMode === "current_page" ||
          item.applyMode === "all_repeated" ||
          item.applyMode === "page_range"
            ? item.applyMode
            : "current_page",
        explicitPages: Array.isArray(item.explicitPages)
          ? item.explicitPages
              .map((page) => Number(page))
              .filter((page) => Number.isInteger(page) && page > 0)
          : [],
      }))
      .filter((item) => item.candidateId.length > 0);
    if (items.length <= 0) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "selections must include at least one valid item.",
      });
    }
    const result = await saveJobSelection(jobId, items);
    return jobOk(
      "Selection stored.",
      {
        selections: items,
        review: result.reviewPayload,
      },
      result.job,
    );
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}
