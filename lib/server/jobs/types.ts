export type TempJobStatus =
  | "created"
  | "uploaded"
  | "analyzing"
  | "analyzed"
  | "applying"
  | "completed"
  | "error"
  | "deleted";

export type TempJobDeletionStatus = "pending" | "deleted" | "failed";

export type TempJobErrorCode =
  | "validation_error"
  | "unsupported_structure"
  | "no_candidates"
  | "runner_timeout"
  | "runner_crash"
  | "artifact_missing"
  | "cleanup_failed"
  | "internal_error";

export type TempDeletionPolicy = "delete_after_both_downloads_or_expiry";

export type TempJobPaths = {
  jobDir: string;
  metadataPath: string;
  sourcePdfPath: string;
  analysisJsonPath: string;
  cleanedPdfPath: string;
  reportJsonPath: string;
  planJsonPath: string;
};

export type TempProcessingJob = {
  jobId: string;
  originalFilename: string;
  createdAt: string;
  expiresAt: string;
  status: TempJobStatus;
  sourcePdfPath: string;
  analysisJsonPath: string;
  cleanedPdfPath: string;
  reportJsonPath: string;
  deletionStatus: TempJobDeletionStatus;
  deletionPolicy: TempDeletionPolicy;
  downloadedCleanedAt?: string;
  downloadedReportAt?: string;
  errorCode?: TempJobErrorCode;
  errorMessage?: string;
};

export type TempJobArtifactType =
  | "source_pdf"
  | "analysis_json"
  | "plan_json"
  | "cleaned_pdf"
  | "report_json";
