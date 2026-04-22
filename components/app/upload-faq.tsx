import type { UploadPageContent } from "@/content/pages/upload";

type UploadFaqProps = {
  content: UploadPageContent["faq"];
};

export function UploadFaq({ content }: UploadFaqProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{content.title}</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {content.items.map((item) => (
          <details
            key={item.title}
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
              {item.title}
            </summary>
            <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
