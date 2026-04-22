import "server-only";

export type JobLogPhase =
  | "job_create"
  | "upload_save"
  | "analyze"
  | "apply"
  | "cleanup"
  | "job_delete";

export type JobLogLevel = "info" | "warn" | "error";

export type JobLogEvent = {
  level: JobLogLevel;
  phase: JobLogPhase;
  jobId?: string;
  ok: boolean;
  durationMs?: number;
  message?: string;
};

export type JobLogger = (event: JobLogEvent) => void;

export const noopJobLogger: JobLogger = () => {};
