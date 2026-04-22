import type { UploadPageContent } from "@/content/pages/upload";

type UploadStepsProps = {
  content: UploadPageContent["howLocalModeWorks"];
};

export function UploadSteps({ content }: UploadStepsProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{content.title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{content.intro}</p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {content.steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Step {index + 1}
            </p>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-600">{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
