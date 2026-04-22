import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const { runPythonCommandMock } = vi.hoisted(() => ({
  runPythonCommandMock: vi.fn(),
}));

vi.mock("@/lib/server/python-runner/process", () => ({
  runPythonCommand: runPythonCommandMock,
}));

import { POST as uploadPost } from "@/app/api/temp-jobs/upload/route";
import { POST as analyzePost } from "@/app/api/temp-jobs/[jobId]/analyze/route";
import { POST as applyPost } from "@/app/api/temp-jobs/[jobId]/apply/route";
import { GET as artifactGet } from "@/app/api/temp-jobs/[jobId]/artifacts/[artifact]/route";
import { resolveJobPaths } from "@/lib/server/temp-storage/paths";

describe("temporary-processing happy path integration", () => {
  beforeAll(async () => {
    await rm(path.join(process.cwd(), "temp", "jobs"), {
      recursive: true,
      force: true,
    });
  });

  beforeEach(() => {
    runPythonCommandMock.mockReset();
    runPythonCommandMock.mockImplementation(async (params: { commandName: string; args: string[] }) => {
      if (params.commandName === "analyze") {
        const outputIdx = params.args.indexOf("--output");
        const outputPath = params.args[outputIdx + 1];
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(
          outputPath,
          JSON.stringify(
            {
              totalCandidates: 1,
              unsupportedPages: [],
              notes: [],
              candidatesByPage: {
                "1": [
                  {
                    id: "text-run-1-0",
                    pageNumber: 1,
                    objectType: "text_run",
                    text: "Sample watermark",
                    label: "Sample watermark",
                    normalizedText: "sample watermark",
                    boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
                    normalizedBoundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
                    repeatKey: "text_run:sample watermark:0.1:0.1:0.2:0.05",
                    repeatCount: 2,
                    confidence: 0.82,
                    removability: "supported",
                    reasons: ["integration test candidate"],
                    identityKey: "text:sample watermark",
                  },
                ],
              },
            },
            null,
            2,
          ),
          "utf-8",
        );
        return {
          ok: true,
          command: "analyze",
          args: params.args,
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 100,
          timedOut: false,
        };
      }

      const outputIdx = params.args.indexOf("--output");
      const reportIdx = params.args.indexOf("--report");
      const outputPath = params.args[outputIdx + 1];
      const reportPath = params.args[reportIdx + 1];
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from("%PDF-1.4\n%mock-cleaned\n"), "utf-8");
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            success: true,
            objectType: "text_run",
            matchedObjectsCount: 2,
            removedObjectsCount: 2,
            warnings: [],
            failureReason: null,
          },
          null,
          2,
        ),
        "utf-8",
      );
      return {
        ok: true,
        command: "apply-plan",
        args: params.args,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 120,
        timedOut: false,
      };
    });
  });

  it("covers upload -> analyze -> apply -> download -> cleanup", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([Buffer.from("%PDF-1.4\n%mock\n")], "demo.pdf", { type: "application/pdf" }),
    );

    const uploadResponse = await uploadPost(
      new Request("http://localhost/api/temp-jobs/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const uploadBody = (await uploadResponse.json()) as {
      success: boolean;
      status: string;
      data?: { jobId: string };
      job?: { deletionPolicy?: string };
    };

    expect(uploadResponse.status).toBe(200);
    expect(uploadBody.success).toBe(true);
    expect(uploadBody.status).toBe("uploaded");
    expect(uploadBody.job?.deletionPolicy).toBe("delete_after_both_downloads_or_expiry");
    const jobId = uploadBody.data?.jobId;
    expect(jobId).toBeTruthy();

    const analyzeResponse = await analyzePost(
      new Request(`http://localhost/api/temp-jobs/${jobId}/analyze`, { method: "POST" }),
      { params: Promise.resolve({ jobId: String(jobId) }) },
    );
    const analyzeBody = (await analyzeResponse.json()) as {
      success: boolean;
      status: string;
      data?: {
        analysis: {
          totalCandidates: number;
          candidatesByPage: Record<string, unknown[]>;
        };
      };
    };

    expect(analyzeResponse.status).toBe(200);
    expect(analyzeBody.success).toBe(true);
    expect(analyzeBody.status).toBe("analyzed");
    expect(analyzeBody.data?.analysis.totalCandidates).toBe(1);
    expect(analyzeBody.data?.analysis.candidatesByPage["1"]?.length).toBe(1);

    const applyResponse = await applyPost(
      new Request(`http://localhost/api/temp-jobs/${jobId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedCandidateId: "text-run-1-0",
          scope: "current",
          currentPage: 1,
          pageCount: 1,
        }),
      }),
      { params: Promise.resolve({ jobId: String(jobId) }) },
    );
    const applyBody = (await applyResponse.json()) as {
      success: boolean;
      status: string;
      data?: { report?: { success: boolean } };
    };

    expect(applyResponse.status).toBe(200);
    expect(applyBody.success).toBe(true);
    expect(applyBody.status).toBe("completed");
    expect(applyBody.data?.report?.success).toBe(true);

    const cleanedResponse = await artifactGet(
      new Request(`http://localhost/api/temp-jobs/${jobId}/artifacts/cleaned`),
      { params: Promise.resolve({ jobId: String(jobId), artifact: "cleaned" }) },
    );
    expect(cleanedResponse.status).toBe(200);
    expect(cleanedResponse.headers.get("content-type")).toContain("application/pdf");

    const paths = resolveJobPaths(String(jobId));
    await expect(stat(paths.jobDir)).resolves.toBeTruthy();

    const reportResponse = await artifactGet(
      new Request(`http://localhost/api/temp-jobs/${jobId}/artifacts/report`),
      { params: Promise.resolve({ jobId: String(jobId), artifact: "report" }) },
    );
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers.get("content-type")).toContain("application/json");

    await expect(stat(paths.jobDir)).rejects.toThrow();
  });
});
