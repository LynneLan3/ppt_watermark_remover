import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ManualReviewPageClient } from "@/components/manual-review/manual-review-page";
import { getManualReviewAlgorithmProfile, isManualReviewEnabled } from "@/lib/server/manual-review/service";

export const metadata: Metadata = {
  title: "Manual Review",
  description: "Internal manual review page for NotebookLM cleanup output.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ManualReviewPage() {
  if (!isManualReviewEnabled()) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ManualReviewPageClient algorithmProfile={getManualReviewAlgorithmProfile()} />
    </main>
  );
}
