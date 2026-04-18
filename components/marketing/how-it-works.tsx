import type { HomePageContent } from "@/content/pages/home";

type HowItWorksProps = {
  content: HomePageContent["howItWorks"];
};

export function HowItWorks({ content }: HowItWorksProps) {
  return (
    <section id="how-it-works" className="px-6 py-14 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {content.title}
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          {content.intro}
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {content.steps.map((step, index) => (
            <li
              key={step.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-semibold text-sky-700">
                Step {index + 1}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
