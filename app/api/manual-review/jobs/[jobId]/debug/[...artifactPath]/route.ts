import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { isManualReviewEnabled, resolveDebugArtifactPath } from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string; artifactPath: string[] }> };

export async function GET(_request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId, artifactPath } = await params;
    const targetPath = await resolveDebugArtifactPath({
      jobId,
      artifactPath,
    });
    const buffer = await readFile(targetPath);
    const fileName = path.basename(targetPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": contentTypeFor(fileName),
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "not found";
    const status = /ENOENT|not found|invalid/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

function contentTypeFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "application/octet-stream";
}
