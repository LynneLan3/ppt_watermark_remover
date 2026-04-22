export type ToolNavLink = {
  label: string;
  href: string;
};

export type ToolFaqItem = {
  question: string;
  answer: string;
};

export type HomeToolContent = {
  header: {
    brand: string;
    nav: ToolNavLink[];
  };
  uploadHero: {
    eyebrow: string;
    title: string;
    description: string;
    trustPoints: string[];
    primaryCta: ToolNavLink;
    secondaryCta: ToolNavLink;
    uploadCard: {
      title: string;
      description: string;
      placeholder: string;
      hint: string;
      chooseFileLabel: string;
      generatePreviewLabel: string;
      waitingStatus: string;
      selectedStatus: string;
      previewReadyStatus: string;
    };
  };
  previewShowcase: {
    id: string;
    title: string;
    description: string;
    beforeCardTitle: string;
    beforeCardHint: string;
    afterCardTitle: string;
    afterCardHint: string;
    note: string;
    primaryCta: ToolNavLink;
  };
  workflowSteps: {
    id: string;
    title: string;
    description: string;
    steps: Array<{
      title: string;
      description: string;
    }>;
  };
  trustStrip: {
    title: string;
    items: Array<{
      title: string;
      description: string;
    }>;
  };
  faq: {
    id: string;
    title: string;
    description: string;
    items: ToolFaqItem[];
  };
  footer: {
    productLinks: ToolNavLink[];
    legalLinks: ToolNavLink[];
    supportLinks: ToolNavLink[];
    disclaimer: string;
    copyright: string;
  };
};

export const homeToolContent: HomeToolContent = {
  header: {
    brand: "NotebookLM Watermark Remover",
    nav: [
      { label: "View processing steps", href: "/#how-it-works" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact", href: "/contact" },
    ],
  },
  uploadHero: {
    eyebrow: "NotebookLM Export Cleanup",
    title: "Remove NotebookLM export watermarks from supported files",
    description:
      "A focused tool flow for NotebookLM PDF and PPTX exports: upload, review preview, and download only after confirmation.",
    trustPoints: [
      "Preview before download",
      "Temporary upload",
      "Auto delete and no training",
      "Secure processing for eligible files",
    ],
    primaryCta: { label: "Upload and preview", href: "/app/upload" },
    secondaryCta: { label: "View processing steps", href: "#how-it-works" },
    uploadCard: {
      title: "Upload NotebookLM export",
      description: "Select a NotebookLM PDF or PPTX export to start a local preview skeleton.",
      placeholder: "Drag and drop PDF/PPTX here",
      hint: "Homepage preview is local-only skeleton. Use upload page for real processing.",
      chooseFileLabel: "Choose NotebookLM export",
      generatePreviewLabel: "Generate preview",
      waitingStatus: "Upload NotebookLM export file",
      selectedStatus: "File selected, click Generate preview",
      previewReadyStatus: "Preview cleaned result is ready",
    },
  },
  previewShowcase: {
    id: "preview",
    title: "Preview cleaned result before you download",
    description:
      "The workflow emphasizes visual review. You can compare before and after states before confirming cleanup output.",
    beforeCardTitle: "Before",
    beforeCardHint: "NotebookLM watermark visible in export preview",
    afterCardTitle: "After",
    afterCardHint: "Watermark area cleaned in supported object-level cases",
    note: "This preview area is a static showcase on the homepage.",
    primaryCta: { label: "Upload and preview", href: "/app/upload" },
  },
  workflowSteps: {
    id: "how-it-works",
    title: "How it works",
    description: "A simple four-step tool flow designed for NotebookLM export cleanup.",
    steps: [
      {
        title: "Upload NotebookLM export",
        description: "Start by uploading your exported PDF or PPTX file.",
      },
      {
        title: "Detect watermark area",
        description: "The tool identifies repeated watermark-like regions in eligible files.",
      },
      {
        title: "Preview cleaned result",
        description: "Review the cleaned preview result before any download action.",
      },
      {
        title: "Download after confirmation",
        description: "Download cleaned file only after you confirm the previewed result.",
      },
    ],
  },
  trustStrip: {
    title: "Trust and processing model",
    items: [
      {
        title: "Temporary upload",
        description: "Files are processed in temporary job storage, not permanent archive storage.",
      },
      {
        title: "Auto delete",
        description: "Artifacts are intended to be deleted after download or short expiry.",
      },
      {
        title: "No training",
        description: "Uploaded document contents are not used to train models.",
      },
      {
        title: "Secure processing",
        description: "The workflow is designed for practical safeguards and quality-protecting checks.",
      },
    ],
  },
  faq: {
    id: "faq",
    title: "Frequently asked questions",
    description: "Common questions for NotebookLM export watermark cleanup.",
    items: [
      {
        question: "Does this support NotebookLM PDF and PPTX exports?",
        answer:
          "The tool is positioned for NotebookLM export cleanup and focuses on supported object-level PDF and PPTX scenarios.",
      },
      {
        question: "Can I preview the result before downloading?",
        answer:
          "Yes. The intended flow is Preview cleaned result first, then Download cleaned file after confirmation.",
      },
      {
        question: "How long are uploaded files stored?",
        answer:
          "Uploads are handled as temporary jobs with short retention, followed by deletion after download or expiry.",
      },
      {
        question: "Will my files be used for model training?",
        answer: "No. Uploaded file contents are not used for model training.",
      },
      {
        question: "Is this a general PPT editing platform?",
        answer:
          "No. This is a focused NotebookLM watermark cleanup tool, not a full presentation editor.",
      },
    ],
  },
  footer: {
    productLinks: [
      { label: "Try the tool", href: "/" },
      { label: "Go to uploader", href: "/app/upload" },
      { label: "NotebookLM cleanup page", href: "/notebooklm-watermark-remover" },
    ],
    legalLinks: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms", href: "/terms" },
      { label: "Disclaimer", href: "/disclaimer" },
    ],
    supportLinks: [
      { label: "Contact", href: "/contact" },
      { label: "View processing steps", href: "/#how-it-works" },
      { label: "FAQ", href: "/#faq" },
    ],
    disclaimer:
      "This tool focuses on supported NotebookLM export watermark scenarios with temporary upload and secure processing.",
    copyright: "© NotebookLM Watermark Remover",
  },
};
