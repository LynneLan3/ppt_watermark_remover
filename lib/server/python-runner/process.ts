import "server-only";

import { spawn } from "node:child_process";

import type { PythonCommandName, PythonRunnerOptions, PythonRunnerResult } from "@/lib/server/python-runner/types";

const DEFAULT_TIMEOUT_MS = 60_000;

export async function runPythonCommand(params: {
  commandName: PythonCommandName;
  args: string[];
  options?: PythonRunnerOptions;
}): Promise<PythonRunnerResult> {
  const startedAt = Date.now();
  const timeoutMs = params.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = params.options?.cwd ?? process.cwd();

  return new Promise<PythonRunnerResult>((resolve) => {
    const child = spawn("python3", params.args, {
      cwd,
      env: params.options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forcedKillTimer: ReturnType<typeof setTimeout> | null = null;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forcedKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forcedKillTimer) {
        clearTimeout(forcedKillTimer);
      }
      resolve({
        ok: false,
        command: params.commandName,
        args: params.args,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forcedKillTimer) {
        clearTimeout(forcedKillTimer);
      }
      resolve({
        ok: exitCode === 0 && !timedOut,
        command: params.commandName,
        args: params.args,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}
