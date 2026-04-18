import Link from "next/link";

import type { HeroContent } from "@/content/pages/home";

type HeroProps = {
  content: HeroContent;
};

export function Hero({ content }: HeroProps) {
  return (
    <section id="top" className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
          {content.eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
          {content.title}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
          {content.description}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
