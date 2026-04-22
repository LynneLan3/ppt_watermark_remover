export type PythonCommandName = "analyze" | "apply-plan";

export type PythonRunnerResult = {
  ok: boolean;
  command: PythonCommandName;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type PythonRunnerOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};
