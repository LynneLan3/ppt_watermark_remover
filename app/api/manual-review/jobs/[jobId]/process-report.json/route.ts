import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { isManualReviewEnabled, resolveArtifactPath } from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

const ARTIFACT_NAME = "process-report.json" as const;
const CONTENT_TYPE = "application/json";
const DOWNLOAD_SUFFIX = "process-report.json";

export async function GET(_request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId } = await params;
    const artifactPath = await resolveArtifactPath({
      jobId,
      artifact: ARTIFACT_NAME,
    });
    const buffer = await readFile(artifactPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": CONTENT_TYPE,
        "content-disposition": `attachment; filename="${jobId}.${DOWNLOAD_SUFFIX}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "not found";
    const status = /ENOENT|not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
