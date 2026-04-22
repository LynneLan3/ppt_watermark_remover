import Link from "next/link";

import type { HomePageContent } from "@/content/pages/home";

type TrustSectionProps = {
  content: HomePageContent["trust"];
};

export function TrustSection({ content }: TrustSectionProps) {
  return (
    <section id="trust" className="px-6 py-12 sm:py-14">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {content.title}
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          {content.intro}
        </p>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {content.highlights.map((item) => (
            <article
              key={item.title}
              className="rounded-xl border border-slate-200 bg-slate-50 p-5"
            >
              <h3 className="text-base font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.description}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm font-medium text-slate-700">{content.note}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href={content.primaryCta.href}
            className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
          >
            {content.primaryCta.label}
          </Link>
          <Link
            href={content.secondaryCta.href}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            {content.secondaryCta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
