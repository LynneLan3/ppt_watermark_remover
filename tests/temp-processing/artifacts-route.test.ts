import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readJobMetadataMock,
  hasArtifactMock,
  getJobArtifactPathMock,
  readArtifactBufferMock,
  registerArtifactDownloadMock,
} = vi.hoisted(() => ({
  readJobMetadataMock: vi.fn(),
  hasArtifactMock: vi.fn(),
  getJobArtifactPathMock: vi.fn(),
  readArtifactBufferMock: vi.fn(),
  registerArtifactDownloadMock: vi.fn(),
}));

vi.mock("@/lib/server/jobs/repository", () => ({
  readJobMetadata: readJobMetadataMock,
  hasArtifact: hasArtifactMock,
}));

vi.mock("@/lib/server/python-runner/engine", () => ({
  getJobArtifactPath: getJobArtifactPathMock,
}));

vi.mock("@/lib/server/jobs/service", () => ({
  readArtifactBuffer: readArtifactBufferMock,
  registerArtifactDownload: registerArtifactDownloadMock,
}));

import { GET } from "@/app/api/temp-jobs/[jobId]/artifacts/[artifact]/route";

describe("temp-jobs artifacts route", () => {
  beforeEach(() => {
    readJobMetadataMock.mockReset();
    hasArtifactMock.mockReset();
    getJobArtifactPathMock.mockReset();
    readArtifactBufferMock.mockReset();
    registerArtifactDownloadMock.mockReset();
  });

  it("returns artifact_missing when requested artifact is absent", async () => {
    readJobMetadataMock.mockResolvedValue({
      jobId: "job-a",
      status: "completed",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deletionStatus: "pending",
      deletionPolicy: "delete_after_both_downloads_or_expiry",
    });
    getJobArtifactPathMock.mockResolvedValue("/tmp/missing.cleaned.pdf");
    hasArtifactMock.mockResolvedValue(false);

    const response = await GET(
      new Request("http://localhost/api/temp-jobs/job-a/artifacts/cleaned"),
      { params: Promise.resolve({ jobId: "job-a", artifact: "cleaned" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      errorCode?: string;
      message: string;
    };

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.status).toBe("completed");
    expect(body.errorCode).toBe("artifact_missing");
    expect(body.message.toLowerCase()).toContain("missing");
  });
});
