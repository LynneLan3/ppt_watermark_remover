import type { Metadata } from "next";

import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { Scenarios } from "@/components/marketing/scenarios";
import { gammaLandingContent } from "@/content/pages/gamma-watermark-remover";

export const metadata: Metadata = {
  title: "Gamma Watermark Remover | Clean Gamma-Exported Presentation Files",
  description:
    "Gamma watermark remover landing page for cleaning Gamma-exported PPT, PPTX, and PDF presentation files before final delivery.",
};

export default function GammaWatermarkRemoverPage() {
  return (
    <main className="bg-slate-100">
      <Hero content={gammaLandingContent.hero} />
      <Benefits content={gammaLandingContent.whyCleanup} />
      <Benefits content={gammaLandingContent.benefits} />
      <Scenarios content={gammaLandingContent.useCases} />
      <Faq content={gammaLandingContent.faq} />
      <FinalCta content={gammaLandingContent.finalCta} />
    </main>
  );
}
