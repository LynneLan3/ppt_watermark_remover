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

export type RemoveWatermarkHowToPageContent = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: LinkItem;
    secondaryCta: LinkItem;
    points: string[];
  };
  watermarkSources: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  manualPain: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  commonCases: {
    title: string;
    intro: string;
    items: ContentCard[];
  };
  previewFirstWorkflow: {
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

export const removeWatermarkHowToPageContent: RemoveWatermarkHowToPageContent = {
  hero: {
    eyebrow: "Remove Watermark from PowerPoint",
    title: "How to remove watermark from PowerPoint exports",
    description:
      "Trying to remove watermark from PowerPoint files? This page focuses on practical how-to intent and a PDF-first preview-confirm-download cleanup flow.",
    primaryCta: {
      href: "/",
      label: "Go to uploader",
    },
    secondaryCta: {
      href: "#preview-first-workflow",
      label: "View processing steps",
    },
    points: [
      "Focused on remove-watermark how-to intent",
      "Covers common export watermark patterns",
      "Preview-first before final download",
    ],
  },
  watermarkSources: {
    title: "Where PowerPoint watermarks usually come from",
    intro:
      "In many slide workflows, watermark-like marks are introduced during export, template reuse, or repeated branding updates.",
    items: [
      {
        title: "Export footer labels",
        description:
          "Some exports include repeated footer-like labels that appear across multiple slides.",
      },
      {
        title: "Repeated brand marks",
        description:
          "Corner logos or repeated brand elements can appear on each slide and require cleanup before sharing.",
      },
      {
        title: "Overlay-style visual elements",
        description:
          "Semi-transparent overlays and repeated decorative elements can look like watermark artifacts in final exports.",
      },
    ],
  },
  manualPain: {
    title: "Why removing them manually is time-consuming",
    intro:
      "Manual removal is often manageable on one slide, but quickly becomes tedious on larger presentation files.",
    items: [
      {
        title: "Repeated edits on every slide",
        description:
          "The same delete-and-adjust steps are repeated again and again, which increases effort and mistakes.",
      },
      {
        title: "Layout shift risk",
        description:
          "Manual editing can cause accidental layout shifts, especially when teams are editing under deadline.",
      },
      {
        title: "Regeneration resets progress",
        description:
          "When a deck is regenerated from source content, previous manual cleanup may need to be redone.",
      },
    ],
  },
  commonCases: {
    title: "Common cases for exported slides",
    intro:
      "These are the most frequent patterns users ask about when trying to remove watermark from PowerPoint exports.",
    items: [
      {
        title: "Repeated export marks on multiple pages",
        description:
          "The same mark appears in similar position across many slides and creates visual noise.",
      },
      {
        title: "Template-derived branding leftovers",
        description:
          "Old template marks remain visible after content updates and become hard to remove slide by slide.",
      },
      {
        title: "Mixed deck sources",
        description:
          "Slides merged from different sources can carry inconsistent watermark-like elements that need cleanup.",
      },
    ],
  },
  previewFirstWorkflow: {
    title: "A simpler preview-first cleanup workflow",
    intro:
      "If manual cleanup is too slow, a preview-first flow can reduce rework by showing the outcome before final download.",
    steps: [
      {
        title: "1) Upload exported PDF file",
        description:
          "Start by uploading the exported PDF in temporary mode for cleanup review.",
      },
      {
        title: "2) Analyze and preview",
        description:
          "Check analysis output, then preview whether cleanup matches your expectation.",
      },
      {
        title: "3) Confirm and download",
        description:
          "Confirm cleanup and download only when preview is suitable for sharing.",
      },
    ],
  },
  faq: {
    title: "FAQ",
    intro: "Practical answers for remove-watermark-from-powerpoint intent.",
    items: [
      {
        question: "How do watermarks usually appear in PowerPoint exports?",
        answer:
          "They often appear as repeated footer labels, corner brand marks, or overlay-style elements carried into exported files.",
      },
      {
        question: "Why is manual removal difficult?",
        answer:
          "Because the same edits repeat across many slides, and layout mistakes become more likely under time pressure.",
      },
      {
        question: "Can I preview cleaned slides first?",
        answer:
          "Yes. A preview-first workflow lets you review output before downloading the cleaned file.",
      },
      {
        question: "Is this a full PowerPoint editor?",
        answer:
          "No. It is a focused cleanup workflow, not a full slide editing suite.",
      },
      {
        question: "Does it support direct PPTX uploads?",
        answer:
          "Not yet. Current Stage 2 upload support is PDF-first only; PPTX support is planned later.",
      },
    ],
  },
  finalCta: {
    title: "Need a faster way to remove watermark from PowerPoint exports?",
    description:
      "Use a preview-first flow to reduce repetitive manual edits before final file sharing.",
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
      { label: "Explore other export cleanup scenarios", href: "/gamma-watermark-remover" },
    ],
  },
};
