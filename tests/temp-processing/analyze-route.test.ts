import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeJobMock, readJobAnalysisMock } = vi.hoisted(() => ({
  analyzeJobMock: vi.fn(),
  readJobAnalysisMock: vi.fn(),
}));

vi.mock("@/lib/server/jobs/service", () => ({
  analyzeJob: analyzeJobMock,
  readJobAnalysis: readJobAnalysisMock,
}));

import { POST } from "@/app/api/temp-jobs/[jobId]/analyze/route";

describe("temp-jobs analyze route", () => {
  beforeEach(() => {
    analyzeJobMock.mockReset();
    readJobAnalysisMock.mockReset();
  });

  it("returns runner_timeout with standardized shape", async () => {
    analyzeJobMock.mockResolvedValue({
      job: {
        jobId: "job-timeout",
        status: "error",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deletionStatus: "pending",
        deletionPolicy: "delete_after_both_downloads_or_expiry",
      },
      runner: {
        ok: false,
        timedOut: true,
        stderr: "traceback details that should not leak",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-timeout/analyze", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-timeout" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      errorCode?: string;
      message: string;
      job?: { status: string };
    };

    expect(response.status).toBe(504);
    expect(body.success).toBe(false);
    expect(body.status).toBe("error");
    expect(body.errorCode).toBe("runner_timeout");
    expect(body.message.toLowerCase()).toContain("timed out");
    expect(body.message).not.toContain("traceback");
    expect(body.job?.status).toBe("error");
  });

  it("returns no_candidates when analysis has zero candidates", async () => {
    analyzeJobMock.mockResolvedValue({
      job: {
        jobId: "job-empty",
        status: "analyzed",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deletionStatus: "pending",
        deletionPolicy: "delete_after_both_downloads_or_expiry",
      },
      runner: {
        ok: true,
        timedOut: false,
        stderr: "",
      },
    });
    readJobAnalysisMock.mockResolvedValue({
      totalCandidates: 0,
      unsupportedPages: [],
      notes: [],
      candidatesByPage: {},
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-empty/analyze", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-empty" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      errorCode?: string;
      message: string;
    };

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe("no_candidates");
    expect(body.message.toLowerCase()).toContain("no candidates");
  });

  it("returns unsupported_structure when no supported candidates", async () => {
    analyzeJobMock.mockResolvedValue({
      job: {
        jobId: "job-unsupported",
        status: "analyzed",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deletionStatus: "pending",
        deletionPolicy: "delete_after_both_downloads_or_expiry",
      },
      runner: {
        ok: true,
        timedOut: false,
        stderr: "",
      },
    });
    readJobAnalysisMock.mockResolvedValue({
      totalCandidates: 3,
      unsupportedPages: [1],
      notes: [],
      candidatesByPage: {
        "1": [{ removability: "unsupported" }],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-unsupported/analyze", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-unsupported" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      errorCode?: string;
      message: string;
    };

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe("unsupported_structure");
    expect(body.message.toLowerCase()).toContain("supported");
  });

  it("returns limitation hint for notebooklm-like unsupported distributions", async () => {
    analyzeJobMock.mockResolvedValue({
      job: {
        jobId: "job-limited",
        status: "analyzed",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deletionStatus: "pending",
        deletionPolicy: "delete_after_both_downloads_or_expiry",
      },
      runner: {
        ok: true,
        timedOut: false,
        stderr: "",
      },
    });
    readJobAnalysisMock.mockResolvedValue({
      totalCandidates: 4,
      unsupportedPages: [1],
      notes: [],
      candidatesByPage: {
        "1": [
          { removability: "unsupported", unsupportedReasonCode: "large_background_image" },
          { removability: "unsupported", unsupportedReasonCode: "large_background_image" },
          { removability: "unsupported", unsupportedReasonCode: "non_repeated_decorative_image" },
          { removability: "unsupported", unsupportedReasonCode: "large_background_image" },
        ],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-limited/analyze", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-limited" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      data?: { limitationHint?: string };
    };

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.data?.limitationHint).toContain("NotebookLM");
  });

  it("returns recommended candidate metadata on success", async () => {
    analyzeJobMock.mockResolvedValue({
      job: {
        jobId: "job-ok",
        status: "analyzed",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deletionStatus: "pending",
        deletionPolicy: "delete_after_both_downloads_or_expiry",
      },
      runner: {
        ok: true,
        timedOut: false,
        stderr: "",
      },
    });
    readJobAnalysisMock.mockResolvedValue({
      totalCandidates: 2,
      unsupportedPages: [],
      notes: [],
      candidatesByPage: {
        "1": [
          {
            id: "image-xobject-1-0",
            pageNumber: 1,
            objectType: "image_xobject",
            confidence: 0.83,
            repeatCount: 3,
            placementHint: "corner",
            reasonCode: "repeated_corner_logo_supported",
            removability: "supported",
          },
        ],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/temp-jobs/job-ok/analyze", { method: "POST" }),
      { params: Promise.resolve({ jobId: "job-ok" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      data?: {
        recommendedCandidate?: {
          id: string;
          pageNumber: number;
          placementHint: string;
          reasonCode?: string;
        } | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.recommendedCandidate?.id).toBe("image-xobject-1-0");
    expect(body.data?.recommendedCandidate?.pageNumber).toBe(1);
    expect(body.data?.recommendedCandidate?.placementHint).toBe("corner");
    expect(body.data?.recommendedCandidate?.reasonCode).toBe("repeated_corner_logo_supported");
  });
});
