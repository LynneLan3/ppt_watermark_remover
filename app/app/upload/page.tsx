import type { Metadata } from "next";

import { UploadShell } from "@/components/app/upload-shell";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { homeToolContent } from "@/content/pages/home-tool";
import { uploadPageContent } from "@/content/pages/upload";

export const metadata: Metadata = {
  title: "Upload NotebookLM export | NotebookLM Watermark Remover",
  description:
    "Upload NotebookLM export, preview cleaned result, and download cleaned file with temporary secure processing.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Header brand={homeToolContent.header.brand} nav={homeToolContent.header.nav} />
      <UploadShell content={uploadPageContent} />
      <Footer content={homeToolContent.footer} />
    </div>
  );
}
