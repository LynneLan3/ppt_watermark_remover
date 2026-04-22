import type { PolicySection } from "@/content/types/policy";

export type DisclaimerContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const disclaimerContent: DisclaimerContent = {
  title: "Disclaimer",
  lastUpdated: "April 20, 2026",
  intro:
    "This page provides important notices about brand references and general use of the NotebookLM Watermark Remover website.",
  sections: [
    {
      title: "No Affiliation with Third-Party Brands",
      paragraphs: [
        "NotebookLM Watermark Remover is an independent project and is not affiliated with, endorsed by, or sponsored by Gamma, Google, NotebookLM, Microsoft, or any other third-party brand referenced on this site.",
        "Any brand names, product names, trademarks, or logos are used only for identification and descriptive compatibility context.",
      ],
    },
    {
      title: "Early Product Status",
      paragraphs: [
        "NotebookLM Watermark Remover includes a temporary upload and preview-first cleanup workflow.",
        "Support depends on file structure and supported-file checks. Unsupported cases may be blocked instead of forcing destructive edits.",
      ],
    },
    {
      title: "No Professional Advice",
      paragraphs: [
        "Content on this site is provided for general informational purposes and does not constitute legal, financial, or professional advice.",
      ],
    },
    {
      title: "Accuracy and Availability",
      paragraphs: [
        "We aim to keep information accurate and up to date, but do not guarantee that all content is complete, current, or error-free at all times.",
      ],
    },
    {
      title: "Future Product Changes",
      paragraphs: [
        "Product capabilities, workflows, and availability may change as development progresses.",
      ],
    },
    {
      title: "Contact",
      paragraphs: [
        "For disclaimer questions, contact: hello@pptwatermarkremover.com.",
      ],
    },
  ],
};
