import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact | PPTWatermarkRemover",
  description:
    "Contact PPTWatermarkRemover to request early access and share your slide cleanup use case.",
};

export default function ContactPage() {
  return (
    <main className="bg-slate-100 px-6 py-16 sm:py-20">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Contact PPTWatermarkRemover
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          We are currently onboarding early users. Share your workflow and we
          will follow up when access opens.
        </p>
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
        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to Homepage
          </Link>
        </div>
      </section>
    </main>
  );
}
