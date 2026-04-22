import Link from "next/link";

import type { HomeToolContent } from "@/content/pages/home-tool";

type PreviewShowcaseProps = {
  content: HomeToolContent["previewShowcase"];
};

export function PreviewShowcase({ content }: PreviewShowcaseProps) {
  return (
    <section id={content.id} className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{content.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{content.description}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{content.beforeCardTitle}</h3>
            <div className="mt-3 h-36 rounded-lg border border-dashed border-slate-300 bg-white sm:h-44" />
            <p className="mt-3 text-xs leading-5 text-slate-600">{content.beforeCardHint}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{content.afterCardTitle}</h3>
            <div className="mt-3 h-36 rounded-lg border border-dashed border-slate-300 bg-white sm:h-44" />
            <p className="mt-3 text-xs leading-5 text-slate-600">{content.afterCardHint}</p>
          </article>
        </div>
        <div className="mt-5">
          <Link
            href={content.primaryCta.href}
            className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
          >
            {content.primaryCta.label}
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">{content.note}</p>
      </div>
    </section>
  );
}
