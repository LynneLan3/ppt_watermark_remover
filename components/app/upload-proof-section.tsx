import type { UploadPageContent } from "@/content/pages/upload";

type UploadProofSectionProps = {
  content: UploadPageContent["proof"];
};

export function UploadProofSection({ content }: UploadProofSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{content.title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{content.intro}</p>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            {content.beforeLabel}
          </p>
          <div className="mt-3 aspect-[16/10] rounded-lg border border-slate-200 bg-white p-3">
            <div className="grid h-full grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50" />
              <div className="rounded-md border border-slate-200 bg-slate-50" />
              <div className="rounded-md border border-slate-200 bg-slate-50" />
              <div className="rounded-md border border-slate-200 bg-slate-50" />
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
            {content.beforeNotes.map((note) => (
              <li key={note}>- {note}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            {content.afterLabel}
          </p>
          <div className="mt-3 aspect-[16/10] rounded-lg border border-slate-200 bg-white p-3">
            <div className="grid h-full gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50" />
              <div className="rounded-md border border-slate-200 bg-slate-50" />
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
            {content.afterNotes.map((note) => (
              <li key={note}>- {note}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
