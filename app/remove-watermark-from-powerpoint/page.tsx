import type { Metadata } from "next";

import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { Scenarios } from "@/components/marketing/scenarios";
import { removeWatermarkFromPowerpointContent } from "@/content/pages/remove-watermark-from-powerpoint";

export const metadata: Metadata = {
  title:
    "Remove Watermark from PowerPoint | Clean Visible Watermark and Export Marks Faster",
  description:
    "Learn how to remove or clean visible watermark and export marks from PowerPoint files faster with a workflow built for repeated presentation cleanup.",
};

export default function RemoveWatermarkFromPowerpointPage() {
  return (
    <main className="bg-slate-100">
      <Hero content={removeWatermarkFromPowerpointContent.hero} />
      <Benefits content={removeWatermarkFromPowerpointContent.watermarkTypes} />
      <Benefits content={removeWatermarkFromPowerpointContent.manualEditing} />
      <Scenarios
        content={removeWatermarkFromPowerpointContent.repetitiveCleanup}
      />
      <Faq content={removeWatermarkFromPowerpointContent.faq} />
      <FinalCta content={removeWatermarkFromPowerpointContent.finalCta} />
    </main>
  );
}
