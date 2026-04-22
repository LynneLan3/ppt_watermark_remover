import { beforeEach, describe, expect, it, vi } from "vitest";

const { readJobMetadataMock, cleanupSingleJobMock } = vi.hoisted(() => ({
  readJobMetadataMock: vi.fn(),
  cleanupSingleJobMock: vi.fn(),
}));

vi.mock("@/lib/server/jobs/repository", () => ({
  readJobMetadata: readJobMetadataMock,
}));

vi.mock("@/lib/server/jobs/service", () => ({
  cleanupSingleJob: cleanupSingleJobMock,
}));

import { POST } from "@/app/api/temp-jobs/[jobId]/cleanup/route";

describe("cleanup route standardized failure", () => {
  beforeEach(() => {
    readJobMetadataMock.mockReset();
    cleanupSingleJobMock.mockReset();
  });

  it("returns cleanup_failed when cleanup operation fails", async () => {
    readJobMetadataMock.mockResolvedValue({
      jobId: "job-cleanup",
      status: "completed",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deletionStatus: "failed",
      deletionPolicy: "delete_after_both_downloads_or_expiry",
    });
    cleanupSingleJobMock.mockResolvedValue({
      success: false,
      errorCode: "cleanup_failed",
      message: "rm failed",
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-cleanup/cleanup", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-cleanup" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      errorCode?: string;
      message: string;
    };

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.status).toBe("completed");
    expect(body.errorCode).toBe("cleanup_failed");
    expect(body.message).toContain("rm failed");
  });
});
