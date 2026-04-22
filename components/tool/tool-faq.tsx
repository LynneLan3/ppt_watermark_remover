import type { HomeToolContent } from "@/content/pages/home-tool";

type ToolFaqProps = {
  content: HomeToolContent["faq"];
};

export function ToolFaq({ content }: ToolFaqProps) {
  return (
    <section id={content.id} className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{content.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{content.description}</p>
        <div className="mt-6 space-y-3">
          {content.items.map((item) => (
            <details key={item.question} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
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
