import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { readJob } from "@/lib/jobs/repository";
import { getWatermarkAlgorithmProfile } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type FeedbackType =
  | "looks_good"
  | "still_has_residue"
  | "white_patch"
  | "text_or_line_damaged"
  | "other";

type FeedbackPayload = {
  page: number;
  feedbackType: FeedbackType;
  note?: string;
};

const FEEDBACK_TYPES = new Set<FeedbackType>([
  "looks_good",
  "still_has_residue",
  "white_patch",
  "text_or_line_damaged",
  "other",
]);

export async function POST(request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const payload = (await request.json()) as FeedbackPayload;
    if (!Number.isInteger(payload.page) || payload.page < 1) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "page must be a positive integer.",
      });
    }
    if (!FEEDBACK_TYPES.has(payload.feedbackType)) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "feedbackType is invalid.",
      });
    }
    await readJob(jobId);

    const outputDir = path.resolve(process.cwd(), "tmp/user-feedback");
    await mkdir(outputDir, { recursive: true });
    const feedbackPath = path.join(outputDir, `${jobId}.jsonl`);
    const row = {
      jobId,
      page: payload.page,
      feedbackType: payload.feedbackType,
      note: sanitizeNote(payload.note),
      algorithmProfile: getWatermarkAlgorithmProfile(),
      createdAt: new Date().toISOString(),
    };
    await appendFile(feedbackPath, `${JSON.stringify(row)}\n`, "utf-8");

    return jobOk("Feedback saved.", {
      savedTo: `tmp/user-feedback/${jobId}.jsonl`,
    });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

function sanitizeNote(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim().slice(0, 500);
}
