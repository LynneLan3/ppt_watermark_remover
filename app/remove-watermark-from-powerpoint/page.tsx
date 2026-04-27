import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { homeToolContent } from "@/content/pages/home-tool";
import { removeWatermarkHowToPageContent } from "@/content/pages/remove-watermark-from-powerpoint";

export const metadata: Metadata = {
  title:
    "Remove Watermark from PowerPoint | PDF-first Preview Workflow Guide",
  description:
    "Remove watermark from PowerPoint guide page focused on manual cleanup pain, common export watermark cases, and a PDF-first preview-confirm-download workflow.",
};

export default function RemoveWatermarkFromPowerpointPage() {
  const content = removeWatermarkHowToPageContent;

  return (
    <div className="min-h-screen bg-slate-100">
      <Header brand={homeToolContent.header.brand} nav={homeToolContent.header.nav} />
      <main>
      <section id="top" className="px-4 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
            {content.hero.eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {content.hero.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            {content.hero.description}
          </p>
          <ul className="mt-6 grid gap-2 sm:grid-cols-3">
            {content.hero.points.map((point) => (
              <li
                key={point}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href={content.hero.primaryCta.href}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              {content.hero.primaryCta.label}
            </Link>
            <Link
              href={content.hero.secondaryCta.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.hero.secondaryCta.label}
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 py-6 sm:px-6 sm:py-8">
        <ContentGridBlock
          title={content.watermarkSources.title}
          intro={content.watermarkSources.intro}
          items={content.watermarkSources.items}
        />
      </section>

      <section className="px-4 py-6 sm:px-6 sm:py-8">
        <ContentGridBlock
          title={content.manualPain.title}
          intro={content.manualPain.intro}
          items={content.manualPain.items}
        />
      </section>

      <section className="px-4 py-6 sm:px-6 sm:py-8">
        <ContentGridBlock
          title={content.commonCases.title}
          intro={content.commonCases.intro}
          items={content.commonCases.items}
        />
      </section>

      <section id="preview-first-workflow" className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
            {content.previewFirstWorkflow.title}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {content.previewFirstWorkflow.intro}
          </p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {content.previewFirstWorkflow.steps.map((step) => (
              <li key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{content.faq.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{content.faq.intro}</p>
          <div className="mt-6 space-y-3">
            {content.faq.items.map((item) => (
              <details
                key={item.question}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                  {item.question}
                </summary>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-8 pb-12 sm:px-6 sm:pb-14">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold text-slate-900">{content.finalCta.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {content.finalCta.description}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={content.finalCta.primaryCta.href}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              {content.finalCta.primaryCta.label}
            </Link>
            <Link
              href={content.finalCta.secondaryCta.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.finalCta.secondaryCta.label}
            </Link>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-900">{content.relatedLinks.title}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
              {content.relatedLinks.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-sky-700 transition-colors hover:text-sky-800"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
      </main>
      <Footer content={homeToolContent.footer} />
    </div>
  );
}

function ContentGridBlock({
  title,
  intro,
  items,
}: {
  title: string;
  intro: string;
  items: Array<{ title: string; description: string }>;
}) {
  return (
    <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{intro}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article key={item.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
