import "server-only";

import { get, head } from "@vercel/blob";

export class SourcePdfNotFoundError extends Error {
  code = "source_pdf_not_found" as const;
}

export class SourcePdfReadFailedError extends Error {
  code = "source_pdf_read_failed" as const;
}

function isUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

function toPathOrUrl(input: string): { pathname?: string; url?: string } {
  if (isUrl(input)) {
    return { url: input };
  }
  return { pathname: input };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(merged);
}

export async function readSourcePdfBuffer(input: {
  sourcePathname?: string | null;
  sourceBlobUrl?: string | null;
}): Promise<{ buffer: Buffer; source: string }> {
  const source = input.sourcePathname || input.sourceBlobUrl;
  if (!source) {
    throw new SourcePdfNotFoundError("Missing sourcePathname/sourceBlobUrl");
  }

  try {
    await head(source, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch {
    throw new SourcePdfNotFoundError(`Source PDF blob not found: ${source}`);
  }

  try {
    const location = toPathOrUrl(source);
    const response = await get(location.pathname ?? location.url!, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!response) {
      throw new SourcePdfNotFoundError(`Source PDF blob not found: ${source}`);
    }

    const maybeArrayBuffer = response as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof maybeArrayBuffer.arrayBuffer === "function") {
      const arr = await maybeArrayBuffer.arrayBuffer();
      return { buffer: Buffer.from(arr), source };
    }

    const maybeStream = response as unknown as { stream?: ReadableStream<Uint8Array> };
    if (maybeStream.stream) {
      return { buffer: await streamToBuffer(maybeStream.stream), source };
    }

    throw new SourcePdfReadFailedError(`Failed to read source PDF: ${source}`);
  } catch (error) {
    if (error instanceof SourcePdfNotFoundError) {
      throw error;
    }
    throw new SourcePdfReadFailedError(`Failed to read source PDF: ${source}`);
  }
}
