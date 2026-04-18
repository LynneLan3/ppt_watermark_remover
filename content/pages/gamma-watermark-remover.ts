import type {
  FinalCtaContent,
  HeroContent,
  HomePageContent,
} from "@/content/pages/home";

type GammaLandingContent = {
  hero: HeroContent;
  whyCleanup: HomePageContent["benefits"];
  benefits: HomePageContent["benefits"];
  useCases: HomePageContent["scenarios"];
  faq: HomePageContent["faq"];
  finalCta: FinalCtaContent;
};

export const gammaLandingContent: GammaLandingContent = {
  hero: {
    eyebrow: "Gamma Watermark Remover",
    title: "Remove watermark artifacts from Gamma-exported presentations",
    description:
      "Clean up Gamma-exported PPT, PPTX, and PDF files before sharing with clients, teams, or classrooms.",
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
    title: "Why Gamma exports often need cleanup",
    intro:
      "Gamma helps teams generate slides quickly, but exported files can still include visual marks that are not ideal for final delivery.",
    items: [
      {
        title: "Client-facing quality standards",
        description:
          "Sales and agency decks need clean, branded output before external reviews or executive meetings.",
      },
      {
        title: "Consistent classroom and training materials",
        description:
          "Educators and trainers often need polished files without extra visual distractions.",
      },
      {
        title: "Faster finalization workflow",
        description:
          "Teams want to keep the speed of AI slide generation while reducing manual cleanup work.",
      },
    ],
  },
  benefits: {
    title: "Benefits of a Gamma-focused cleanup flow",
    intro:
      "PPTWatermarkRemover is focused on practical output quality for real presentation workflows.",
    items: [
      {
        title: "Improve deck trust and readability",
        description:
          "Present cleaner slides that keep attention on your message, not export artifacts.",
      },
      {
        title: "Reduce repetitive post-export edits",
        description:
          "Avoid time-consuming manual fixes each time you prepare a final deck version.",
      },
      {
        title: "Prepare files for delivery and reuse",
        description:
          "Get presentation files into a cleaner state for handoff, archiving, and future updates.",
      },
    ],
  },
  useCases: {
    title: "Common Gamma cleanup use cases",
    intro:
      "Teams use Gamma for many workflows. These are the early scenarios we are prioritizing.",
    items: [
      {
        title: "Sales and proposal decks",
        description:
          "Remove distracting marks from customer-facing presentations before meetings and submissions.",
      },
      {
        title: "Agency campaign reports",
        description:
          "Clean exported strategy and performance decks before sharing with clients and stakeholders.",
      },
      {
        title: "Learning and workshop materials",
        description:
          "Polish educational slides for courses, webinars, and internal training sessions.",
      },
    ],
  },
  faq: {
    title: "Gamma watermark remover FAQ",
    items: [
      {
        question: "Does this page support Gamma only?",
        answer:
          "This landing page is optimized for Gamma-related search intent, but the product direction covers broader presentation cleanup use cases.",
      },
      {
        question: "Can I upload Gamma files now?",
        answer:
          "Not yet. Stage 1 is marketing and early-access validation. You can contact us to share your workflow and join updates.",
      },
      {
        question: "Will PPT, PPTX, and PDF be supported?",
        answer:
          "Yes, those are the key export formats we are prioritizing based on early user demand.",
      },
      {
        question: "How do I get notified when access opens?",
        answer:
          "Use the contact page and include your use case details. We will follow up with early access information.",
      },
    ],
  },
  finalCta: {
    title: "Need cleaner Gamma-exported presentation files?",
    description:
      "Tell us what files you export and we will notify you when early access is available.",
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
