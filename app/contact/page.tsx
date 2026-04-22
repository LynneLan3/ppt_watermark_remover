import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { homeToolContent } from "@/content/pages/home-tool";

export const metadata: Metadata = {
  title: "Support | NotebookLM Watermark Remover",
  description:
    "Support contact for upload, preview-first cleanup, temporary upload policy, and supported export scenarios.",
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Header brand={homeToolContent.header.brand} nav={homeToolContent.header.nav} />
      <main className="px-6 py-16 sm:py-20">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Support
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Contact us if you need help with upload, preview, supported-file checks, or
            temporary upload policy questions.
          </p>
          <ul className="mt-5 space-y-2">
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Temporary upload with auto delete policy
            </li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No training on uploaded file contents
            </li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Preview-first cleanup workflow for supported exports
            </li>
          </ul>
          <div className="mt-8 space-y-3 text-sm text-slate-700">
            <p>
              Email:{" "}
              <a
                href="mailto:hello@pptwatermarkremover.com"
                className="font-semibold text-sky-700 hover:text-sky-800"
              >
                hello@pptwatermarkremover.com
              </a>
            </p>
            <p>Response target: within 2 business days.</p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app/upload"
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              Go to uploader
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Try the tool
            </Link>
          </div>
        </section>
      </main>
      <Footer content={homeToolContent.footer} />
    </div>
  );
}
