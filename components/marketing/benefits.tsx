import type { HomePageContent } from "@/content/pages/home";

type BenefitsProps = {
  content: HomePageContent["benefits"];
};

export function Benefits({ content }: BenefitsProps) {
  return (
    <section id="benefits" className="px-6 py-14 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {content.title}
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          {content.intro}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.items.map((item) => (
            <article
              key={item.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
