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
    secondaryCta: ToolNavLink;
    uploadCard: {
      title: string;
      description: string;
      placeholder: string;
      hint: string;
      algorithmProfile: string;
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
    title: "Free beta preview for NotebookLM PDF cleanup",
    description:
      "Upload a NotebookLM PDF export, review cleaned pages, and download only after preview confirmation.",
    trustPoints: [
      "Preview the cleaned result before downloading.",
      "Works best for NotebookLM PDF exports with bottom-right marks.",
      "Complex diagrams or dense backgrounds may leave slight residue.",
      "Review every page before downloading.",
    ],
    secondaryCta: { label: "View processing steps", href: "#how-it-works" },
    uploadCard: {
      title: "Upload NotebookLM export",
      description:
        "PDF only. Maximum file size 4MB. Works best for NotebookLM PDF exports up to 30 pages.",
      placeholder: "Drag and drop PDF here",
      hint: "Files are processed temporarily and automatically deleted after download or short expiry.",
      algorithmProfile: "stable-light-complex-v5",
      chooseFileLabel: "Choose NotebookLM export",
      generatePreviewLabel: "Generate preview",
      waitingStatus: "Upload NotebookLM PDF export",
      selectedStatus: "File selected, ready to upload and process",
      previewReadyStatus: "Cleaned preview is ready",
    },
  },
  previewShowcase: {
    id: "homepage-preview-showcase",
    title: "Preview cleaned result before you download",
    description:
      "The workflow emphasizes visual review. You can compare before and after states before confirming cleanup output.",
    beforeCardTitle: "Before cleanup",
    beforeCardHint: "NotebookLM watermark visible in export preview",
    afterCardTitle: "After cleanup",
    afterCardHint: "Watermark area cleaned in supported object-level cases",
    note: "This preview area is a static showcase on the homepage.",
    primaryCta: { label: "Start from homepage upload", href: "/#homepage-upload" },
  },
  workflowSteps: {
    id: "how-it-works",
    title: "How it works",
    description: "A Stage 2 product workflow for NotebookLM PDF cleanup.",
    steps: [
      {
        title: "Upload PDF",
        description: "Upload your NotebookLM-exported PDF into temporary processing storage.",
      },
      {
        title: "Automatic processing",
        description: "Processing starts automatically after upload using the stable-light-complex-v5 profile.",
      },
      {
        title: "Preview and download",
        description: "Review original and cleaned pages side by side, then download the cleaned PDF.",
      },
      {
        title: "Download and auto delete",
        description: "Download cleaned output after preview confirmation; temporary files are deleted after download or short expiry.",
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
        question: "Does this support NotebookLM exports?",
        answer:
          "Yes. Stage 2 is PDF-first for NotebookLM exports. PPTX support is not available yet.",
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
      "NotebookLM Watermark Remover is currently PDF-first with temporary upload, short retention, and auto delete after download or expiry.",
    copyright: "© NotebookLM Watermark Remover",
  },
};
