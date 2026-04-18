import Link from "next/link";

import type { HomePageContent } from "@/content/pages/home";

type HomeExploreLinksProps = {
  content: HomePageContent["exploreLinks"];
};

export function HomeExploreLinks({ content }: HomeExploreLinksProps) {
  return (
    <section id="related-cleanup-pages" className="px-6 py-12 sm:py-14">
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
              key={item.href}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.description}
              </p>
              <Link
                href={item.href}
                className="mt-4 inline-flex text-sm font-semibold text-sky-700 transition-colors hover:text-sky-800"
              >
                {item.anchorText}
              </Link>
            </article>
          ))}
        </div>
        <p className="mt-6 max-w-4xl text-sm leading-7 text-slate-600 sm:text-base">
          {content.contextualSentence.before}{" "}
          {content.contextualSentence.links.map((link, index) => (
            <span key={link.href}>
              <Link
                href={link.href}
                className="font-semibold text-sky-700 transition-colors hover:text-sky-800"
              >
                {link.label}
              </Link>
              {index < content.contextualSentence.links.length - 2 ? ", " : ""}
              {index === content.contextualSentence.links.length - 2
                ? ", or "
                : ""}
            </span>
          ))}
          {content.contextualSentence.after}
        </p>
      </div>
    </section>
  );
}
