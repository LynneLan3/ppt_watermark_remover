import type {
  FinalCtaContent,
  HeroContent,
  HomePageContent,
} from "@/content/pages/home";

type NotebooklmLandingContent = {
  hero: HeroContent;
  whyCleanup: HomePageContent["benefits"];
  benefits: HomePageContent["benefits"];
  useCases: HomePageContent["scenarios"];
  faq: HomePageContent["faq"];
  finalCta: FinalCtaContent;
};

export const notebooklmLandingContent: NotebooklmLandingContent = {
  hero: {
    eyebrow: "NotebookLM Watermark Remover",
    title: "Clean NotebookLM-exported slides before final delivery",
    description:
      "Remove distracting marks from NotebookLM-exported PPTX and PDF files so your presentation looks polished and professional.",
    primaryCta: {
      href: "/contact",
      label: "Request Early Access",
    },
    secondaryCta: {
      href: "#faq",
      label: "See FAQ",
    },
  },
  whyCleanup: {
    title: "Why NotebookLM exports can need cleanup",
    intro:
      "NotebookLM helps teams generate ideas and materials quickly, but exported presentation files can still need final visual refinement before sharing.",
    items: [
      {
        title: "Presentation-ready polish",
        description:
          "Client and stakeholder decks often require cleaner visuals for credibility and trust.",
      },
      {
        title: "Less manual correction work",
        description:
          "Teams want to avoid repetitive slide-by-slide edits after every export cycle.",
      },
      {
        title: "Consistent output across teams",
        description:
          "Standardized cleanup improves quality when multiple people produce and share decks.",
      },
    ],
  },
  benefits: {
    title: "Benefits of NotebookLM-focused cleanup",
    intro:
      "PPTWatermarkRemover is built to support practical post-export workflows for presentation teams.",
    items: [
      {
        title: "Cleaner files for external sharing",
        description:
          "Deliver NotebookLM-exported PPTX and PDF files with fewer visual distractions.",
      },
      {
        title: "Faster turnaround to final deck",
        description:
          "Move from generated draft to presentation-ready version with less friction.",
      },
      {
        title: "Stronger brand and message clarity",
        description:
          "Keep audience attention on your content by removing avoidable export artifacts.",
      },
    ],
  },
  useCases: {
    title: "Common NotebookLM cleanup use cases",
    intro:
      "Early users request NotebookLM cleanup for recurring business and educational workflows.",
    items: [
      {
        title: "Internal briefings and strategy decks",
        description:
          "Prepare cleaner presentation exports for leadership updates and team alignment.",
      },
      {
        title: "Client proposals and review meetings",
        description:
          "Polish deck files before sharing with external stakeholders or decision makers.",
      },
      {
        title: "Training and educational materials",
        description:
          "Create cleaner learning content for workshops, lessons, and webinar sessions.",
      },
    ],
  },
  faq: {
    title: "NotebookLM watermark remover FAQ",
    items: [
      {
        question: "Can I upload NotebookLM files now?",
        answer:
          "Not yet. Stage 1 is focused on marketing and early access while we validate demand and workflows.",
      },
      {
        question: "Which NotebookLM exports are prioritized?",
        answer:
          "We are prioritizing NotebookLM-exported PPTX and PDF file cleanup use cases first.",
      },
      {
        question: "Is this page only for NotebookLM users?",
        answer:
          "This page targets NotebookLM-specific search intent, while the broader product vision covers additional presentation cleanup scenarios.",
      },
      {
        question: "How can I get updates?",
        answer:
          "Use the contact page with your use case details and we will follow up with early access updates.",
      },
    ],
  },
  finalCta: {
    title: "Need cleaner NotebookLM-exported presentation files?",
    description:
      "Share your workflow today and we will notify you as soon as early access opens.",
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
