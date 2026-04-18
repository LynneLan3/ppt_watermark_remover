import type {
  FinalCtaContent,
  HeroContent,
  HomePageContent,
} from "@/content/pages/home";

type RemoveWatermarkFromPowerpointContent = {
  hero: HeroContent;
  watermarkTypes: HomePageContent["benefits"];
  manualEditing: HomePageContent["benefits"];
  repetitiveCleanup: HomePageContent["scenarios"];
  faq: HomePageContent["faq"];
  finalCta: FinalCtaContent;
};

export const removeWatermarkFromPowerpointContent: RemoveWatermarkFromPowerpointContent =
  {
    hero: {
      eyebrow: "Remove Watermark from PowerPoint",
      title: "Remove visible watermark marks from PowerPoint files faster",
      description:
        "Clean PowerPoint export marks and watermark-like overlays from presentation files so your slides look ready for sharing and presenting.",
      primaryCta: {
        href: "/contact",
        label: "Request Early Access",
      },
      secondaryCta: {
        href: "#faq",
        label: "See FAQ",
      },
    },
    watermarkTypes: {
      title: "Common types of PowerPoint watermark",
      intro:
        "PowerPoint files can contain different visual marks depending on how the deck was exported, generated, or reused.",
      items: [
        {
          title: "Text overlays and export labels",
          description:
            "Visible labels, draft markers, or export-related text that appears over slide content.",
        },
        {
          title: "Background stamp-like graphics",
          description:
            "Logos, faded marks, or repeated design elements that interfere with final presentation readability.",
        },
        {
          title: "Inherited marks from reused templates",
          description:
            "Watermark-like elements carried over from source templates or previously shared deck versions.",
        },
      ],
    },
    manualEditing: {
      title: "When manual editing works",
      intro:
        "Manual cleanup can be a reasonable approach when the deck is small and the issue appears in only a few places.",
      items: [
        {
          title: "One-time deck edits",
          description:
            "If you only need to fix a handful of slides, direct edits in PowerPoint may be enough.",
        },
        {
          title: "Simple and isolated marks",
          description:
            "Manual removal is easier when the mark is consistent and not deeply embedded in slide layouts.",
        },
        {
          title: "Low-volume workflows",
          description:
            "Occasional presenters may prefer quick manual fixes over adopting a repeatable cleanup process.",
        },
      ],
    },
    repetitiveCleanup: {
      title: "When cleanup becomes repetitive or slow",
      intro:
        "As deck volume increases, repeated manual edits can consume time and create inconsistent output quality.",
      items: [
        {
          title: "Weekly client or internal presentation cycles",
          description:
            "Recurring deck production often turns manual watermark cleanup into a time sink.",
        },
        {
          title: "Teams managing multiple versions",
          description:
            "Version updates across many files increase the chance of missed cleanup and inconsistent quality.",
        },
        {
          title: "Fast-moving AI-assisted content workflows",
          description:
            "When slide drafts are generated quickly, post-export cleanup can become a recurring bottleneck.",
        },
      ],
    },
    faq: {
      title: "Remove watermark from PowerPoint FAQ",
      items: [
        {
          question: "Can I upload PowerPoint files now for cleanup?",
          answer:
            "Not yet. Stage 1 is focused on marketing and early-access validation. Contact us to share your use case.",
        },
        {
          question: "Is this for PPT and PPTX workflows?",
          answer:
            "Yes. PowerPoint cleanup workflows are a core focus, including common visible watermark and export mark scenarios.",
        },
        {
          question: "Will this help with repeated deck cleanup tasks?",
          answer:
            "That is the main direction. We are prioritizing workflows where manual cleanup becomes repetitive across many files.",
        },
        {
          question: "How can I get early access updates?",
          answer:
            "Use the contact page and describe your file volume and workflow. We will follow up with next steps.",
        },
      ],
    },
    finalCta: {
      title: "Need a faster way to remove PowerPoint watermark marks?",
      description:
        "Share your workflow and we will notify you when early access opens.",
      primaryCta: {
        href: "/contact",
        label: "Contact Us",
      },
      secondaryCta: {
        href: "#top",
        label: "Back to Top",
      },
    },
  };
