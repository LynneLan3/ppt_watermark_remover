"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import type { HomeToolContent } from "@/content/pages/home-tool";

type UploadHeroProps = {
  content: HomeToolContent["uploadHero"];
};

export function UploadHero({ content }: UploadHeroProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewReady, setPreviewReady] = useState(false);

  const statusText = useMemo(() => {
    if (previewReady) {
      return content.uploadCard.previewReadyStatus;
    }
    if (selectedFile) {
      return content.uploadCard.selectedStatus;
    }
    return content.uploadCard.waitingStatus;
  }, [content.uploadCard.previewReadyStatus, content.uploadCard.selectedStatus, content.uploadCard.waitingStatus, previewReady, selectedFile]);

  const fileSizeText = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    const mb = selectedFile.size / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }, [selectedFile]);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleSelectFile = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) {
      return;
    }
    setSelectedFile(file);
    setPreviewReady(false);
  };

  const handleGeneratePreview = () => {
    if (!selectedFile) {
      return;
    }
    setPreviewReady(true);
    document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="px-4 py-10 sm:px-6 sm:py-12">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
            {content.eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {content.title}
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600">{content.description}</p>
          <ul className="mt-5 space-y-2">
            {content.trustPoints.map((point) => (
              <li
                key={point}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={content.primaryCta.href}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              {content.primaryCta.label}
            </Link>
            <Link
              href={content.secondaryCta.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.secondaryCta.label}
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900">{content.uploadCard.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{content.uploadCard.description}</p>
          <button
            type="button"
            onClick={openPicker}
            className="mt-5 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center transition-colors hover:bg-slate-100"
          >
            <p className="text-sm font-medium text-slate-700">{content.uploadCard.placeholder}</p>
          </button>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.uploadCard.chooseFileLabel}
            </button>
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={!selectedFile}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {content.uploadCard.generatePreviewLabel}
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-700">{statusText}</p>
          {selectedFile ? (
            <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {selectedFile.name} {fileSizeText ? `(${fileSizeText})` : ""}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">{content.uploadCard.hint}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(event) => handleSelectFile(event.target.files)}
          />
        </div>
      </div>
    </section>
  );
}
