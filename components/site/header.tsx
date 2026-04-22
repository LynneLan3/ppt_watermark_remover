import Link from "next/link";

import type { ToolNavLink } from "@/content/pages/home-tool";

type HeaderProps = {
  brand: string;
  nav: ToolNavLink[];
};

export function Header({ brand, nav }: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold text-slate-900 sm:text-base">
          {brand}
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4 sm:gap-6">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-slate-600 transition-colors hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
