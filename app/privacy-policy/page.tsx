import type { Metadata } from "next";

import { privacyPolicyContent } from "@/content/pages/privacy-policy";

export const metadata: Metadata = {
  title: "Privacy Policy | PPTWatermarkRemover",
  description:
    "Privacy Policy for the Stage 1 PPTWatermarkRemover marketing and contact website.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="bg-slate-100 px-6 py-16 sm:py-20">
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
  );
}
