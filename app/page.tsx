import type { Metadata } from "next";

import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HomeExploreLinks } from "@/components/marketing/home-explore-links";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Scenarios } from "@/components/marketing/scenarios";
import { homePageContent } from "@/content/pages/home";

export const metadata: Metadata = {
  title: "PPT Watermark Remover | Clean AI-Exported Slides",
  description:
    "Remove watermark distractions from AI-exported presentation files. Join early access for PPTWatermarkRemover.",
};

export default function HomePage() {
  return (
    <main className="bg-slate-100">
      <Hero content={homePageContent.hero} />
      <HomeExploreLinks content={homePageContent.exploreLinks} />
      <Benefits content={homePageContent.benefits} />
      <Scenarios content={homePageContent.scenarios} />
      <HowItWorks content={homePageContent.howItWorks} />
      <Faq content={homePageContent.faq} />
      <FinalCta content={homePageContent.finalCta} />
    </main>
  );
}
