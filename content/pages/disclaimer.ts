import type { PolicySection } from "@/content/pages/privacy-policy";

export type DisclaimerContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const disclaimerContent: DisclaimerContent = {
  title: "Disclaimer",
  lastUpdated: "April 18, 2026",
  intro:
    "This page provides important notices about brand references and general use of the PPTWatermarkRemover website.",
  sections: [
    {
      title: "No Affiliation with Third-Party Brands",
      paragraphs: [
        "PPTWatermarkRemover is an independent project and is not affiliated with, endorsed by, or sponsored by Gamma, Google, NotebookLM, Microsoft, or any other third-party brand referenced on this site.",
        "Any brand names, product names, trademarks, or logos are used only for identification and descriptive compatibility context.",
      ],
    },
    {
      title: "Informational Website",
      paragraphs: [
        "The current Stage 1 website is for marketing, informational content, and contact intake. It is not yet a production file-processing platform.",
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
        "Product capabilities, workflows, and availability may change as development progresses beyond Stage 1.",
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
