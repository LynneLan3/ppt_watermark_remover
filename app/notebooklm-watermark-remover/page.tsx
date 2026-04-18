import type { Metadata } from "next";

import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { Scenarios } from "@/components/marketing/scenarios";
import { notebooklmLandingContent } from "@/content/pages/notebooklm-watermark-remover";

export const metadata: Metadata = {
  title:
    "NotebookLM Watermark Remover | Clean NotebookLM-Exported PPTX and PDF Files",
  description:
    "NotebookLM watermark remover landing page for cleaning NotebookLM-exported PPTX and PDF files before presenting or sharing.",
};

export default function NotebooklmWatermarkRemoverPage() {
  return (
    <main className="bg-slate-100">
      <Hero content={notebooklmLandingContent.hero} />
      <Benefits content={notebooklmLandingContent.whyCleanup} />
      <Benefits content={notebooklmLandingContent.benefits} />
      <Scenarios content={notebooklmLandingContent.useCases} />
      <Faq content={notebooklmLandingContent.faq} />
      <FinalCta content={notebooklmLandingContent.finalCta} />
    </main>
  );
}
