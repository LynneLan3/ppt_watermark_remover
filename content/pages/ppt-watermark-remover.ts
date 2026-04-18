import type {
  FinalCtaContent,
  HeroContent,
  HomePageContent,
} from "@/content/pages/home";

type PptLandingContent = {
  hero: HeroContent;
  cleanupProblems: HomePageContent["benefits"];
  benefits: HomePageContent["benefits"];
  useCases: HomePageContent["scenarios"];
  faq: HomePageContent["faq"];
  finalCta: FinalCtaContent;
};

export const pptLandingContent: PptLandingContent = {
  hero: {
    eyebrow: "PPT Watermark Remover",
    title: "Clean visible watermark marks from PowerPoint presentation files",
    description:
      "Remove distracting watermark and export marks from PPT and PowerPoint files so your deck is ready for client, classroom, and internal presentation use.",
    primaryCta: {
      href: "/contact",
      label: "Request Early Access",
    },
    secondaryCta: {
      href: "#faq",
      label: "See FAQ",
    },
  },
  cleanupProblems: {
    title: "What a PPT watermark is and why cleanup matters",
    intro:
      "A PPT watermark is a visible mark, label, or export artifact that appears on slides and can reduce presentation quality in final delivery.",
    items: [
      {
        title: "Distracting visuals on key slides",
        description:
          "Unwanted marks can draw attention away from your message in sales, teaching, or reporting decks.",
      },
      {
        title: "Manual edits across many pages",
        description:
          "Cleaning each slide by hand is slow and often repeated whenever a new export is created.",
      },
      {
        title: "Inconsistent file quality for sharing",
        description:
          "Teams need cleaner PPT output before sending files to customers, partners, or leadership.",
      },
    ],
  },
  benefits: {
    title: "Benefits of PPT watermark cleanup",
    intro:
      "PPTWatermarkRemover focuses on practical cleanup outcomes for presentation teams.",
    items: [
      {
        title: "More professional-looking decks",
        description:
          "Present polished slides that support trust and strong first impressions.",
      },
      {
        title: "Faster path from draft to final",
        description:
          "Reduce repetitive editing work when preparing slides for delivery deadlines.",
      },
      {
        title: "Better consistency across outputs",
        description:
          "Keep file quality steady across projects, teams, and recurring deck updates.",
      },
    ],
  },
  useCases: {
    title: "Common PPT cleanup use cases",
    intro:
      "Users rely on PPT cleanup across client work, internal communication, and education.",
    items: [
      {
        title: "Client pitch and proposal decks",
        description:
          "Clean presentation files before external meetings and decision-making sessions.",
      },
      {
        title: "Internal reports and reviews",
        description:
          "Share cleaner status and strategy decks with managers and cross-functional teams.",
      },
      {
        title: "Course and workshop materials",
        description:
          "Prepare readable slides for teaching, training, and learning sessions.",
      },
    ],
  },
  faq: {
    title: "PPT watermark remover FAQ",
    items: [
      {
        question: "Can I remove marks from PPT files today?",
        answer:
          "Not yet. Stage 1 focuses on marketing and early access while we validate workflows and demand.",
      },
      {
        question: "Does this support standard PowerPoint formats?",
        answer:
          "Yes, PPT and PowerPoint cleanup scenarios are a core priority for the first release direction.",
      },
      {
        question: "Will this help with AI-exported presentation files too?",
        answer:
          "Yes. The broader product scope includes cleanup for common AI-exported presentation file workflows.",
      },
      {
        question: "How do I join the early access list?",
        answer:
          "Use the contact page and share your cleanup use case. We will follow up with early access updates.",
      },
    ],
  },
  finalCta: {
    title: "Need cleaner PPT and PowerPoint files?",
    description:
      "Tell us your workflow and we will let you know when early access opens.",
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
