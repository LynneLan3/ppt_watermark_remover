import { beforeEach, describe, expect, it, vi } from "vitest";

const { markArtifactDownloadedMock, cleanupJobByIdMock } = vi.hoisted(() => ({
  markArtifactDownloadedMock: vi.fn(),
  cleanupJobByIdMock: vi.fn(),
}));

vi.mock("@/lib/server/jobs/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/jobs/repository")>(
    "@/lib/server/jobs/repository",
  );
  return {
    ...actual,
    markArtifactDownloaded: markArtifactDownloadedMock,
  };
});

vi.mock("@/lib/server/cleanup/expired-jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/cleanup/expired-jobs")>(
    "@/lib/server/cleanup/expired-jobs",
  );
  return {
    ...actual,
    cleanupJobById: cleanupJobByIdMock,
  };
});

import { registerArtifactDownload } from "@/lib/server/jobs/service";

describe("deletion policy: delete_after_both_downloads_or_expiry", () => {
  beforeEach(() => {
    markArtifactDownloadedMock.mockReset();
    cleanupJobByIdMock.mockReset();
  });

  it("does not cleanup after only one artifact download", async () => {
    markArtifactDownloadedMock.mockResolvedValueOnce({
      jobId: "job-1",
      downloadedCleanedAt: new Date().toISOString(),
      downloadedReportAt: undefined,
      deletionPolicy: "delete_after_both_downloads_or_expiry",
    });

    const result = await registerArtifactDownload({
      jobId: "job-1",
      artifact: "cleaned",
    });

    expect(result.cleanupTriggered).toBe(false);
    expect(result.cleanupSucceeded).toBe(false);
    expect(cleanupJobByIdMock).not.toHaveBeenCalled();
  });

  it("triggers cleanup after both artifacts are downloaded", async () => {
    markArtifactDownloadedMock.mockResolvedValueOnce({
      jobId: "job-2",
      downloadedCleanedAt: new Date().toISOString(),
      downloadedReportAt: new Date().toISOString(),
      deletionPolicy: "delete_after_both_downloads_or_expiry",
    });
    cleanupJobByIdMock.mockResolvedValueOnce(undefined);

    const result = await registerArtifactDownload({
      jobId: "job-2",
      artifact: "report",
    });

    expect(result.cleanupTriggered).toBe(true);
    expect(result.cleanupSucceeded).toBe(true);
    expect(cleanupJobByIdMock).toHaveBeenCalledTimes(1);
    expect(cleanupJobByIdMock).toHaveBeenCalledWith("job-2", expect.any(Function));
  });
});
