import { cleanupExpiredJobs } from "@/lib/cleanup/expired-jobs";
import { jobError, jobOk } from "@/lib/jobs/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const summary = await cleanupExpiredJobs();
    return jobOk("Expired jobs cleanup completed.", summary);
  } catch (error) {
    return jobError({
      httpStatus: 500,
      code: "internal_error",
      message: error instanceof Error ? error.message : "cleanup failed",
    });
  }
}
