import Link from "next/link";

import type { HomeToolContent } from "@/content/pages/home-tool";

type FooterProps = {
  content: HomeToolContent["footer"];
};

export function Footer({ content }: FooterProps) {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Product</h2>
            <ul className="mt-3 space-y-2">
              {content.productLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Legal</h2>
            <ul className="mt-3 space-y-2">
              {content.legalLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Support</h2>
            <ul className="mt-3 space-y-2">
              {content.supportLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p className="mt-8 text-sm leading-6 text-slate-600">{content.disclaimer}</p>
        <p className="mt-3 text-xs text-slate-500">{content.copyright}</p>
      </div>
    </footer>
  );
}
