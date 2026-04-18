import Link from "next/link";

import type { FinalCtaContent } from "@/content/pages/home";

type FinalCtaProps = {
  content: FinalCtaContent;
};

export function FinalCta({ content }: FinalCtaProps) {
  return (
    <section id="final-cta" className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {content.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
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
