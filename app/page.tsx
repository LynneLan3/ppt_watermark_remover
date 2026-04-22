import type { Metadata } from "next";

import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { PreviewShowcase } from "@/components/tool/preview-showcase";
import { ToolFaq } from "@/components/tool/tool-faq";
import { TrustStrip } from "@/components/tool/trust-strip";
import { UploadHero } from "@/components/tool/upload-hero";
import { WorkflowSteps } from "@/components/tool/workflow-steps";
import { homeToolContent } from "@/content/pages/home-tool";

export const metadata: Metadata = {
  title: "NotebookLM Watermark Remover | Upload, Preview, and Clean Exports",
  description:
    "Brand-first entry for NotebookLM Watermark Remover. Upload exported files, preview cleaned results, and download cleaned output with temporary upload, auto delete, and no training.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Header brand={homeToolContent.header.brand} nav={homeToolContent.header.nav} />
      <main>
        <UploadHero content={homeToolContent.uploadHero} />
        <PreviewShowcase content={homeToolContent.previewShowcase} />
        <WorkflowSteps content={homeToolContent.workflowSteps} />
        <TrustStrip content={homeToolContent.trustStrip} />
        <ToolFaq content={homeToolContent.faq} />
      </main>
      <Footer content={homeToolContent.footer} />
    </div>
  );
}
