"use client";

import { useRef, useState } from "react";

import type { UploadPageContent } from "@/content/pages/upload";

type UploadDropzoneCardProps = {
  content: UploadPageContent["toolPanel"];
  fileName: string | null;
  fileSizeBytes?: number | null;
  onFileSelected: (file: File) => void;
  onFileRejected: (message: string) => void;
  disabled?: boolean;
};

export function UploadDropzoneCard({
  content,
  fileName,
  fileSizeBytes = null,
  onFileSelected,
  onFileRejected,
  disabled = false,
}: UploadDropzoneCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const openPicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const handleFileList = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) {
      return;
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      onFileRejected("Please select a valid PDF file (.pdf).");
      return;
    }
    onFileSelected(file);
  };

  const fileSizeLabel =
    typeof fileSizeBytes === "number" ? `${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB` : null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">{content.uploadTitle}</h2>

      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setIsDragOver(true);
          }
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          if (!disabled) {
            handleFileList(event.dataTransfer.files);
          }
        }}
        className={`rounded-xl border border-dashed p-6 transition-colors ${
          isDragOver
            ? "border-sky-400 bg-sky-50"
            : "border-slate-300 bg-slate-50 hover:bg-slate-100"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg border border-slate-300 bg-white" />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Upload NotebookLM export
            </p>
            <p className="text-xs text-slate-600">
              Click to choose a PDF export from your device
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {content.uploadButtonLabel}
        </button>
        <p className="mt-3 text-xs text-slate-600">{content.supportedFormatsLabel}</p>
        {fileName ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
            Selected: {fileName}
            {fileSizeLabel ? ` (${fileSizeLabel})` : ""}
          </p>
        ) : null}
      </div>

      <p className="text-xs leading-5 text-slate-600">{content.helperText}</p>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => handleFileList(event.target.files)}
      />
    </div>
  );
}
