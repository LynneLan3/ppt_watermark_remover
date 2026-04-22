import type { Metadata } from "next";

<<<<<<< HEAD
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { PreviewShowcase } from "@/components/tool/preview-showcase";
import { ToolFaq } from "@/components/tool/tool-faq";
import { TrustStrip } from "@/components/tool/trust-strip";
import { UploadHero } from "@/components/tool/upload-hero";
import { WorkflowSteps } from "@/components/tool/workflow-steps";
import { homeToolContent } from "@/content/pages/home-tool";
=======
import { Benefits } from "@/components/marketing/benefits";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HomeExploreLinks } from "@/components/marketing/home-explore-links";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Scenarios } from "@/components/marketing/scenarios";
import { homePageContent } from "@/content/pages/home";
>>>>>>> origin/main

export const metadata: Metadata = {
  title: "NotebookLM Watermark Remover | Upload, Preview, and Clean Exports",
  description:
    "Brand-first entry for NotebookLM Watermark Remover. Upload exported files, preview cleaned results, and download cleaned output with temporary upload, auto delete, and no training.",
};

export default function HomePage() {
  return (
<<<<<<< HEAD
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
=======
    <main className="bg-slate-100">
      <Hero content={homePageContent.hero} />
      <HomeExploreLinks content={homePageContent.exploreLinks} />
      <Benefits content={homePageContent.benefits} />
      <Scenarios content={homePageContent.scenarios} />
      <HowItWorks content={homePageContent.howItWorks} />
      <Faq content={homePageContent.faq} />
      <FinalCta content={homePageContent.finalCta} />
    </main>
>>>>>>> origin/main
  );
}
