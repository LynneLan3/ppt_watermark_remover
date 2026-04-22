import type { UploadPageContent } from "@/content/pages/upload";

type UploadSupportedLimitsProps = {
  scenarios: UploadPageContent["scenarios"];
  limits: UploadPageContent["limits"];
};

export function UploadSupportedLimits({
  scenarios,
  limits,
}: UploadSupportedLimitsProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{scenarios.title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{scenarios.intro}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">{scenarios.title}</h3>
          <p className="mt-1 text-xs text-slate-600">{scenarios.intro}</p>
          <div className="mt-3 space-y-2">
            {scenarios.items.map((item) => (
              <div key={item.title} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">{limits.title}</h3>
          <p className="mt-1 text-xs text-slate-600">{limits.intro}</p>
          <ul className="mt-3 space-y-2">
            {limits.items.map((item) => (
              <li key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-700">
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
