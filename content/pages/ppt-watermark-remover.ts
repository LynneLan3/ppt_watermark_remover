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

export type PptSeoPageContent = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: LinkItem;
    secondaryCta: LinkItem;
    points: string[];
  };
  whatItHelpsWith: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  supportedScenarios: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  whyManualSlow: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  workflow: {
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

export const pptSeoPageContent: PptSeoPageContent = {
  hero: {
    eyebrow: "PPT Watermark Remover",
    title: "PPT Watermark Remover for PDF-first presentation exports",
    description:
      "Need a PPT watermark remover? This page focuses on PDF-first presentation cleanup intent with upload, analysis, preview, confirmation, and download.",
    primaryCta: {
      href: "/",
      label: "Try the tool",
    },
    secondaryCta: {
      href: "#how-workflow-works",
      label: "View processing steps",
    },
    points: [
      "For general presentation watermark cleanup",
      "Preview cleaned result before download",
      "Temporary upload, auto delete, no training",
    ],
  },
  whatItHelpsWith: {
    title: "What a PPT watermark remover helps with",
    intro:
      "A PPT watermark remover helps reduce repeated visible marks in exported presentation files before sharing them with others.",
    items: [
      {
        title: "Cleaner deck delivery",
        description:
          "Make exported slides easier to present and easier to read in business and education contexts.",
      },
      {
        title: "Repeat-task reduction",
        description:
          "Avoid redoing the same visual cleanup every time a new PDF export is generated.",
      },
      {
        title: "More consistent presentation quality",
        description:
          "Use a consistent workflow across teams to keep final presentation files more uniform.",
      },
    ],
  },
  supportedScenarios: {
    title: "Supported presentation cleanup scenarios",
    intro:
      "The strongest matches are repeated, export-like marks that appear across multiple slides in similar positions.",
    items: [
      {
        title: "Repeated export footer marks",
        description:
          "Footer-like repeated labels are among the most common cleanup requests in presentation exports.",
      },
      {
        title: "Repeated corner or header brand marks",
        description:
          "Small repeated brand marks near corners or headers are typical targets for cleanup review.",
      },
      {
        title: "Cross-team sharing files",
        description:
          "Files prepared for client review, leadership updates, and partner handoffs often require cleaner exports.",
      },
    ],
  },
  whyManualSlow: {
    title: "Why exported presentation files are hard to clean manually",
    intro:
      "Manual cleanup often looks simple at first, but becomes slow and error-prone when slide count and version count increase.",
    items: [
      {
        title: "Slide-by-slide repetition",
        description:
          "The same cleanup action can repeat across many pages, especially for recurring presentation formats.",
      },
      {
        title: "Version churn",
        description:
          "When a deck is regenerated, manual edits are often lost and must be done again.",
      },
      {
        title: "Inconsistent outcomes",
        description:
          "Different editors and rushed updates can produce inconsistent visual quality in final files.",
      },
    ],
  },
  workflow: {
    title: "How the workflow works",
    intro:
      "The product flow is designed to stay simple: upload source export, preview cleaned result, then download cleaned file.",
    steps: [
      {
        title: "1) Upload presentation export",
        description:
          "Upload your exported file in temporary mode to start cleanup analysis.",
      },
      {
        title: "2) Preview cleaned result",
        description:
          "Review preview output before deciding to download, rather than committing blind edits.",
      },
      {
        title: "3) Download cleaned file",
        description:
          "Download cleaned output once the preview looks right for your sharing scenario.",
      },
    ],
  },
  faq: {
    title: "FAQ",
    intro: "Quick answers for users searching for a PPT watermark remover.",
    items: [
      {
        question: "Does it support PPTX files?",
        answer:
          "Not yet. Current Stage 2 support is PDF-first; PPTX is out of scope for now.",
      },
      {
        question: "Can I preview before download?",
        answer:
          "Yes. The flow is preview-first so you can inspect cleaned output before downloading.",
      },
      {
        question: "Is it only for NotebookLM exports?",
        answer:
          "No. This page targets broader presentation watermark remover intent beyond NotebookLM-specific cases.",
      },
      {
        question: "Does it work for repeated export marks?",
        answer:
          "Repeated export-like marks are common target scenarios, especially when they recur in similar positions.",
      },
      {
        question: "Are files stored permanently?",
        answer:
          "No. The workflow uses temporary upload with auto delete behavior and no model training on uploaded files.",
      },
    ],
  },
  finalCta: {
    title: "Ready to clean your presentation export?",
    description:
      "Start with upload and preview, then download cleaned file when the output matches your expectations.",
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
      { label: "Read the NotebookLM-specific page", href: "/notebooklm-watermark-remover" },
      { label: "Need step-by-step? Use the PowerPoint guide", href: "/remove-watermark-from-powerpoint" },
    ],
  },
};
