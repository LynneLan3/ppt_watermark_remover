import type { Metadata } from "next";

import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { Scenarios } from "@/components/marketing/scenarios";
import { pptLandingContent } from "@/content/pages/ppt-watermark-remover";

export const metadata: Metadata = {
  title:
    "PPT Watermark Remover | Clean Watermark and Export Marks from PowerPoint Files",
  description:
    "PPT watermark remover landing page for removing or cleaning visible watermark and export marks from PPT and PowerPoint files.",
};

export default function PptWatermarkRemoverPage() {
  return (
    <main className="bg-slate-100">
      <Hero content={pptLandingContent.hero} />
      <Benefits content={pptLandingContent.cleanupProblems} />
      <Benefits content={pptLandingContent.benefits} />
      <Scenarios content={pptLandingContent.useCases} />
      <Faq content={pptLandingContent.faq} />
      <FinalCta content={pptLandingContent.finalCta} />
    </main>
  );
}
