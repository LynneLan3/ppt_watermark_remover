import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES } from "@/lib/server/api/upload-validation";
import { POST } from "@/app/api/temp-jobs/upload/route";

function makeRequestWithFile(file: File): Request {
  const formData = new FormData();
  formData.append("file", file);
  return new Request("http://localhost/api/temp-jobs/upload", {
    method: "POST",
    body: formData,
  });
}

describe("temp-jobs upload validation", () => {
  it("rejects non-PDF upload with validation_error", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "demo.txt", {
      type: "text/plain",
    });
    const response = await POST(makeRequestWithFile(file));
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      message: string;
      errorCode?: string;
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.status).toBe("error");
    expect(body.errorCode).toBe("validation_error");
    expect(body.message).toContain("PDF");
  });

  it("rejects empty file with validation_error", async () => {
    const file = new File([new Uint8Array([])], "empty.pdf", {
      type: "application/pdf",
    });
    const response = await POST(makeRequestWithFile(file));
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      message: string;
      errorCode?: string;
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.status).toBe("error");
    expect(body.errorCode).toBe("validation_error");
    expect(body.message.toLowerCase()).toContain("empty");
  });

  it("rejects invalid MIME type with validation_error", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "input.pdf", {
      type: "text/plain",
    });
    const response = await POST(makeRequestWithFile(file));
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      message: string;
      errorCode?: string;
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.status).toBe("error");
    expect(body.errorCode).toBe("validation_error");
    expect(body.message.toLowerCase()).toContain("mime");
  });

  it("rejects too-large file with validation_error", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.pdf", {
      type: "application/pdf",
    });
    const response = await POST(makeRequestWithFile(file));
    const body = (await response.json()) as {
      success: boolean;
      status: string;
      message: string;
      errorCode?: string;
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.status).toBe("error");
    expect(body.errorCode).toBe("validation_error");
    expect(body.message.toLowerCase()).toContain("max size");
  });
});
