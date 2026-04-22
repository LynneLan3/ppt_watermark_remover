import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  markJobStatusMock,
  readJobMetadataMock,
  resolveJobPathsMock,
  runPythonCommandMock,
} = vi.hoisted(() => ({
  markJobStatusMock: vi.fn(),
  readJobMetadataMock: vi.fn(),
  resolveJobPathsMock: vi.fn(),
  runPythonCommandMock: vi.fn(),
}));

vi.mock("@/lib/server/jobs/repository", () => ({
  markJobStatus: markJobStatusMock,
  readJobMetadata: readJobMetadataMock,
}));

vi.mock("@/lib/server/temp-storage/paths", () => ({
  resolveJobPaths: resolveJobPathsMock,
}));

vi.mock("@/lib/server/python-runner/process", () => ({
  runPythonCommand: runPythonCommandMock,
}));

import { runAnalyzeForJob } from "@/lib/server/python-runner/engine";

describe("python analyze timeout handling", () => {
  beforeEach(() => {
    markJobStatusMock.mockReset();
    readJobMetadataMock.mockReset();
    resolveJobPathsMock.mockReset();
    runPythonCommandMock.mockReset();
  });

  it("sets job status to error with runner_timeout classification", async () => {
    markJobStatusMock
      .mockResolvedValueOnce({
        jobId: "job-timeout",
        sourcePdfPath: "/tmp/source.pdf",
      })
      .mockResolvedValueOnce({
        jobId: "job-timeout",
        status: "error",
      });
    resolveJobPathsMock.mockReturnValue({
      analysisJsonPath: "/tmp/analysis.json",
    });
    runPythonCommandMock.mockResolvedValueOnce({
      ok: false,
      command: "analyze",
      args: [],
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 45_000,
      timedOut: true,
    });

    const result = await runAnalyzeForJob({ jobId: "job-timeout" });

    expect(result.ok).toBe(false);
    expect(markJobStatusMock).toHaveBeenNthCalledWith(1, "job-timeout", "analyzing");
    expect(markJobStatusMock).toHaveBeenNthCalledWith(
      2,
      "job-timeout",
      "error",
      expect.objectContaining({ code: "runner_timeout" }),
    );
  });
});
