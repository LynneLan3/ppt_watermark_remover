export type CtaLink = {
  href: string;
  label: string;
};

export type HeroContent = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
};

export type BenefitItem = {
  title: string;
  description: string;
};

export type ScenarioItem = {
  title: string;
  description: string;
};

export type HowItWorksStep = {
  title: string;
  description: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type FinalCtaContent = {
  title: string;
  description: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
};

export type TrustSectionContent = {
  title: string;
  intro: string;
  highlights: BenefitItem[];
  note: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
};

export type ExploreLinkItem = {
  title: string;
  description: string;
  href: string;
  anchorText: string;
};

export type HomePageContent = {
  hero: HeroContent;
  trust: TrustSectionContent;
  exploreLinks: {
    title: string;
    intro: string;
    items: ExploreLinkItem[];
    contextualSentence: {
      before: string;
      links: Array<{
        href: string;
        label: string;
      }>;
      after: string;
    };
  };
  benefits: {
    title: string;
    intro: string;
    items: BenefitItem[];
  };
  scenarios: {
    title: string;
    intro: string;
    items: ScenarioItem[];
  };
  howItWorks: {
    title: string;
    intro: string;
    steps: HowItWorksStep[];
  };
  faq: {
    title: string;
    items: FaqItem[];
  };
  finalCta: FinalCtaContent;
};

export const homePageContent: HomePageContent = {
  hero: {
    eyebrow: "PPT Watermark Remover",
    title: "Clean up AI-exported slides before you present",
    description:
      "PPTWatermarkRemover helps you remove distracting watermarks from exported presentation files so your deck looks polished and client-ready.",
    primaryCta: {
      href: "/contact",
      label: "Request Early Access",
    },
    secondaryCta: {
      href: "#faq",
      label: "See FAQ",
    },
  },
  trust: {
    title: "Temporary processing trust model",
    intro:
      "The primary upload workflow uses temporary processing with short retention and explicit deletion behavior.",
    highlights: [
      {
        title: "Temporary upload",
        description:
          "Uploaded files are stored only for analysis, preview, and downloadable output generation.",
      },
      {
        title: "Auto delete policy",
        description:
          "Files are intended to be deleted after download or short expiry windows.",
      },
      {
        title: "No training",
        description: "Uploaded file contents are not used for model training.",
      },
    ],
    note: "Current status: early temporary-processing beta. No permanent archive is intended.",
    primaryCta: {
      href: "/app/upload",
      label: "Upload and preview",
    },
    secondaryCta: {
      href: "/privacy-policy",
      label: "View privacy policy",
    },
  },
  exploreLinks: {
    title: "Explore Related PPT Cleanup Pages",
    intro:
      "Compare common watermark and export cleanup scenarios, then jump straight to the page that best matches your presentation file problem.",
    items: [
      {
        title: "PPT Watermark Remover",
        description:
          "Open the core cleanup page focused on removing watermark traces and export marks from presentation files.",
        href: "/ppt-watermark-remover",
        anchorText: "Remove watermarks from PPT exports",
      },
      {
        title: "Remove Watermark from PowerPoint",
        description:
          "Use a focused workflow page for repeated PowerPoint cleanup tasks when slides need fast visual fixes.",
        href: "/remove-watermark-from-powerpoint",
        anchorText: "Fix PowerPoint watermark cleanup workflows",
      },
      {
        title: "Gamma Watermark Remover",
        description:
          "Review cleanup guidance tailored to Gamma-exported presentation files before client delivery.",
        href: "/gamma-watermark-remover",
        anchorText: "Clean Gamma-exported presentation files",
      },
      {
        title: "NotebookLM Watermark Remover",
        description:
          "See how to clean NotebookLM-generated slide exports with fewer manual edits across PPTX and PDF outputs.",
        href: "/notebooklm-watermark-remover",
        anchorText: "Clean NotebookLM slide exports",
      },
      {
        title: "Contact for Early Access",
        description:
          "Share your cleanup use case and request early access if you need consistent presentation output quality.",
        href: "/contact",
        anchorText: "Request early access for presentation cleanup",
      },
    ],
    contextualSentence: {
      before: "Different export issues often require different cleanup paths. If you need to",
      links: [
        {
          href: "/remove-watermark-from-powerpoint",
          label: "remove visible marks from PowerPoint slides",
        },
        {
          href: "/gamma-watermark-remover",
          label: "clean Gamma presentation exports",
        },
        {
          href: "/notebooklm-watermark-remover",
          label: "fix NotebookLM slide artifacts",
        },
      ],
      after: ", these focused pages can help you choose the right workflow faster.",
    },
  },
  benefits: {
    title: "Why teams use PPTWatermarkRemover",
    intro:
      "Designed for people shipping presentations fast and needing clean slides that look professional.",
    items: [
      {
        title: "Save manual cleanup time",
        description:
          "Reduce repetitive editing work when exported slides include unwanted visual marks.",
      },
      {
        title: "Protect presentation quality",
        description:
          "Keep your decks consistent and trustworthy for sales pitches, classes, and client reviews.",
      },
      {
        title: "Built for common export formats",
        description:
          "Focused on practical cleanup workflows around AI-generated presentations and shared deck files.",
      },
    ],
  },
  scenarios: {
    title: "Who it is for",
    intro:
      "If presentations are part of your weekly workflow, this tool is built for you.",
    items: [
      {
        title: "Freelancers",
        description:
          "Deliver polished slides to clients without spending extra time fixing every export issue manually.",
      },
      {
        title: "Agencies",
        description:
          "Keep output quality high across teams when decks move from AI generation to final delivery.",
      },
      {
        title: "Educators and creators",
        description:
          "Prepare cleaner teaching and content slides before publishing or presenting.",
      },
    ],
  },
  howItWorks: {
    title: "How it works",
    intro:
      "Stage 1 is focused on early access. Processing workflow details are coming next.",
    steps: [
      {
        title: "Share your cleanup use case",
        description:
          "Tell us what file types and watermark patterns you need to handle.",
      },
      {
        title: "Join early access",
        description:
          "We confirm fit and invite qualified users to the first release group.",
      },
      {
        title: "Get notified when uploads open",
        description:
          "You will be first to know when the production cleanup workflow goes live.",
      },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    items: [
      {
        question: "Can I upload files right now?",
        answer:
          "Not yet. Stage 1 is a marketing and waitlist phase while we validate demand and prioritize file workflows.",
      },
      {
        question: "What formats are you planning to support?",
        answer:
          "We are prioritizing presentation-related exports, including PPT, PPTX, and PDF use cases common in AI-generated slide workflows.",
      },
      {
        question: "Is this for personal and business use?",
        answer:
          "Yes. We are collecting requirements from freelancers, agencies, educators, and creators to shape the first release.",
      },
      {
        question: "How do I request access?",
        answer:
          "Use the contact page to share your use case and expected volume. We will follow up with early access details.",
      },
    ],
  },
  finalCta: {
    title: "Need cleaner slides for your next presentation?",
    description:
      "Tell us your workflow and we will notify you when early access opens.",
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
