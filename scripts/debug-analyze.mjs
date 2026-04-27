#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function runCmd(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: pnpm analyze:debug -- <path-to-pdf>");
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), input);
  const pdfBuffer = await fs.readFile(resolved);
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdfBuffer);
  const pageCount = doc.getPageCount();

  const python3 = await runCmd("python3", ["--version"]);
  const python = await runCmd("python", ["--version"]);
  const dependencyCheck = await runCmd("python3", ["-c", "import pikepdf; import fitz; print('ok')"]);

  const analyzerScript = "engine/python/cli.py";
  const extractScript = "python/extract_page_commands.py";

  const output = {
    inputPdf: resolved,
    pdfBufferBytes: pdfBuffer.byteLength,
    selectedAnalyzer: python3.ok ? "python" : "js-fallback",
    pythonAvailable: {
      python3: python3.ok,
      python: python.ok,
      python3Version: (python3.stdout || python3.stderr).trim() || null,
      pythonVersion: (python.stdout || python.stderr).trim() || null,
    },
    scriptExists: {
      analyzerScript,
      analyzerScriptExists: await exists(analyzerScript),
      extractScript,
      extractScriptExists: await exists(extractScript),
    },
    dependencyCheck: {
      ok: dependencyCheck.ok,
      stderr: dependencyCheck.stderr.trim() || null,
    },
    analysisResult: {
      pageCount,
      recommendedProcessMode: "raster_page",
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: {
          name: error?.name || "Error",
          message: error?.message || String(error),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
