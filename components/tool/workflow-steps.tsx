import type { HomeToolContent } from "@/content/pages/home-tool";

type WorkflowStepsProps = {
  content: HomeToolContent["workflowSteps"];
};

export function WorkflowSteps({ content }: WorkflowStepsProps) {
  return (
    <section id={content.id} className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{content.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{content.description}</p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2">
          {content.steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Step {index + 1}
              </p>
              <h3 className="mt-2 text-base font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
