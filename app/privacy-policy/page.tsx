import type { Metadata } from "next";

import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { homeToolContent } from "@/content/pages/home-tool";
import { privacyPolicyContent } from "@/content/pages/privacy-policy";

export const metadata: Metadata = {
  title: "Privacy Policy | NotebookLM Watermark Remover",
  description:
    "Privacy details for temporary upload, preview-first cleanup, auto delete behavior, and no-training policy.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Header brand={homeToolContent.header.brand} nav={homeToolContent.header.nav} />
      <main className="px-6 py-16 sm:py-20">
        <article className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {privacyPolicyContent.title}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Last updated: {privacyPolicyContent.lastUpdated}
          </p>
          <p className="mt-4 text-base leading-7 text-slate-600">
            {privacyPolicyContent.intro}
          </p>
        </header>
        <div className="mt-10 space-y-8">
          {privacyPolicyContent.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-slate-900">
                {section.title}
              </h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-slate-600">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
        </article>
      </main>
      <Footer content={homeToolContent.footer} />
    </div>
  );
}
