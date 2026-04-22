import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readdirMock,
  deleteJobFilesMock,
  isJobExpiredMock,
  markDeletionStatusMock,
  readJobMetadataMock,
} = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  deleteJobFilesMock: vi.fn(),
  isJobExpiredMock: vi.fn(),
  markDeletionStatusMock: vi.fn(),
  readJobMetadataMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: readdirMock,
}));

vi.mock("@/lib/server/jobs/repository", () => ({
  deleteJobFiles: deleteJobFilesMock,
  isJobExpired: isJobExpiredMock,
  markDeletionStatus: markDeletionStatusMock,
  readJobMetadata: readJobMetadataMock,
}));

import { cleanupExpiredJobs, cleanupJobById } from "@/lib/server/cleanup/expired-jobs";

describe("cleanup hardening behavior", () => {
  beforeEach(() => {
    readdirMock.mockReset();
    deleteJobFilesMock.mockReset();
    isJobExpiredMock.mockReset();
    markDeletionStatusMock.mockReset();
    readJobMetadataMock.mockReset();
  });

  it("marks deletionStatus as failed when cleanup throws", async () => {
    markDeletionStatusMock.mockResolvedValueOnce({});
    deleteJobFilesMock.mockRejectedValueOnce(new Error("rm failed"));
    markDeletionStatusMock.mockResolvedValueOnce({});

    await expect(cleanupJobById("job-cleanup-fail")).rejects.toThrow("rm failed");

    expect(markDeletionStatusMock).toHaveBeenNthCalledWith(1, "job-cleanup-fail", "deleted");
    expect(markDeletionStatusMock).toHaveBeenNthCalledWith(
      2,
      "job-cleanup-fail",
      "failed",
      expect.objectContaining({ code: "cleanup_failed" }),
    );
  });

  it("cleans expired jobs through expiry cleanup path", async () => {
    readdirMock.mockResolvedValueOnce(["job-expired"]);
    readJobMetadataMock.mockResolvedValueOnce({
      jobId: "job-expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    isJobExpiredMock.mockReturnValueOnce(true);
    markDeletionStatusMock.mockResolvedValueOnce({});
    deleteJobFilesMock.mockResolvedValueOnce(undefined);

    const summary = await cleanupExpiredJobs();

    expect(summary.scannedJobs).toBe(1);
    expect(summary.deletedJobs).toEqual(["job-expired"]);
    expect(summary.failedJobs).toEqual([]);
    expect(deleteJobFilesMock).toHaveBeenCalledWith("job-expired", expect.any(Object));
  });
});
