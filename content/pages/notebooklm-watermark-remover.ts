type LinkItem = {
  label: string;
  href: string;
};

type ContentCard = {
  title: string;
  description: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

export type NotebooklmSeoPageContent = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: LinkItem;
    secondaryCta: LinkItem;
    points: string[];
  };
  whyCleanupMatters: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  commonUseCases: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  whyManualCleanupSlow: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  howToolWorks: {
    title: string;
    intro: string;
    steps: ContentCard[];
  };
  faq: {
    title: string;
    intro: string;
    items: FaqItem[];
  };
  finalCta: {
    title: string;
    description: string;
    primaryCta: LinkItem;
    secondaryCta: LinkItem;
  };
  relatedLinks: {
    title: string;
    links: LinkItem[];
  };
};

export const notebooklmSeoPageContent: NotebooklmSeoPageContent = {
  hero: {
    eyebrow: "NotebookLM Watermark Remover",
    title: "NotebookLM Watermark Remover for PDF-first exports",
    description:
      "Looking for a NotebookLM watermark remover? This page explains PDF-first post-export cleanup with a real upload, analysis, preview, confirmation, and download workflow.",
    primaryCta: {
      href: "/",
      label: "Try the tool",
    },
    secondaryCta: {
      href: "#how-the-tool-works",
      label: "View processing steps",
    },
    points: [
      "Built for NotebookLM export cleanup intent",
      "Preview cleaned result before download",
      "Temporary upload, auto delete, no training",
    ],
  },
  whyCleanupMatters: {
    title: "Why cleanup matters for NotebookLM exports",
    intro:
      "NotebookLM helps users create material quickly, but exported files may still need visual cleanup before final sharing.",
    items: [
      {
        title: "Share-ready presentation quality",
        description:
          "Teams often need cleaner files before sending to clients, teammates, or external stakeholders.",
      },
      {
        title: "Consistent visual output",
        description:
          "When multiple people create files, a consistent cleanup step helps maintain quality and trust.",
      },
      {
        title: "Faster handoff to final review",
        description:
          "A focused NotebookLM watermark remover workflow reduces last-minute formatting friction.",
      },
    ],
  },
  commonUseCases: {
    title: "Common use cases",
    intro:
      "The most common search intent behind \"notebooklm watermark remover\" comes from practical sharing scenarios.",
    items: [
      {
        title: "Client updates and proposal decks",
        description:
          "Users want cleaner exports before review meetings or proposal delivery.",
      },
      {
        title: "Internal strategy and briefing files",
        description:
          "Teams need polished materials for recurring updates without spending time on repetitive edits.",
      },
      {
        title: "Education and training materials",
        description:
          "Instructors and creators often clean exports before publishing or presenting.",
      },
      {
        title: "PDF-first workflow",
        description:
          "Stage 2 currently focuses on NotebookLM PDF exports. PPTX support is planned later.",
      },
    ],
  },
  whyManualCleanupSlow: {
    title: "Why manual cleanup is slow",
    intro:
      "Manually removing repeated marks from exported PDFs is usually more time-consuming than expected.",
    items: [
      {
        title: "Repetitive page-by-page edits",
        description:
          "The same action is repeated across many pages, which creates avoidable editing fatigue.",
      },
      {
        title: "Different structure in every file",
        description:
          "NotebookLM exports are not always identical, so manual steps can break from one file to another.",
      },
      {
        title: "Higher risk of visual mistakes",
        description:
          "Manual edits can shift layout or leave inconsistent artifacts before final delivery.",
      },
    ],
  },
  howToolWorks: {
    title: "How the tool works",
    intro:
      "The product flow is intentionally simple and action-oriented for NotebookLM watermark remover use.",
    steps: [
      {
        title: "1) Upload NotebookLM export",
        description:
          "Start by uploading your NotebookLM-exported file in temporary upload mode.",
      },
      {
        title: "2) Preview cleaned result",
        description:
          "Review preview output and confirm cleanup before any download.",
      },
      {
        title: "3) Download cleaned file",
        description:
          "Download cleaned output after confirmation, instead of committing blindly.",
      },
    ],
  },
  faq: {
    title: "FAQ",
    intro:
      "Quick answers for users searching for a NotebookLM watermark remover.",
    items: [
      {
        question: "Does it work for NotebookLM PDF exports?",
        answer:
          "It is designed for NotebookLM export cleanup workflows and prioritizes supported PDF cases where reliable preview and cleanup can be provided.",
      },
      {
        question: "Does it support PPTX files now?",
        answer:
          "Not yet. Stage 2 is PDF-first only. PPTX support is currently out of scope.",
      },
      {
        question: "Can I preview the cleaned result first?",
        answer:
          "Yes. The flow is built around preview before download so users can review results before exporting cleaned files.",
      },
      {
        question: "Is it a full presentation editor?",
        answer:
          "No. It is a focused NotebookLM watermark remover and cleanup tool, not a full slide authoring platform.",
      },
      {
        question: "Are files stored permanently?",
        answer:
          "No. Files are temporary and deleted after download or short expiry.",
      },
      {
        question: "Is this affiliated with Google or NotebookLM?",
        answer:
          "No. This is an independent tool for NotebookLM export cleanup workflows and is not affiliated with Google or NotebookLM.",
      },
    ],
  },
  finalCta: {
    title: "Ready to clean a NotebookLM export?",
    description:
      "Start with upload and preview, then download cleaned file when the result looks right.",
    primaryCta: {
      href: "/",
      label: "Upload and preview",
    },
    secondaryCta: {
      href: "/",
      label: "Try the tool",
    },
  },
  relatedLinks: {
    title: "Related pages",
    links: [
      { label: "See the broader PPT cleanup page", href: "/ppt-watermark-remover" },
      { label: "Open the PowerPoint-specific guide", href: "/remove-watermark-from-powerpoint" },
    ],
  },
};
