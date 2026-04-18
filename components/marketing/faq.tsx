import type { HomePageContent } from "@/content/pages/home";

type FaqProps = {
  content: HomePageContent["faq"];
};

export function Faq({ content }: FaqProps) {
  return (
    <section id="faq" className="bg-slate-50 px-6 py-14 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {content.title}
        </h2>
        <div className="mt-8 space-y-3">
          {content.items.map((item) => (
            <details
              key={item.question}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <summary className="cursor-pointer list-none text-base font-semibold text-slate-900">
                {item.question}
              </summary>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
