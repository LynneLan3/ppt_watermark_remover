import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { isManualReviewEnabled, resolveQaExportPath } from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId } = await params;
    const artifactPath = await resolveQaExportPath({
      jobId,
      artifact: "qa-dataset.json",
    });
    const buffer = await readFile(artifactPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${jobId}.qa-dataset.json"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "not found";
    const status = /ENOENT|not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
