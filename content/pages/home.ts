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

export type HomePageContent = {
  hero: HeroContent;
  trust: TrustSectionContent;
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
    eyebrow: "PPTWatermarkRemover",
    title: "Clean up PPT, PPTX, and PDF presentations before you share",
    description:
      "PPTWatermarkRemover helps teams remove distracting repeated marks from presentation files with temporary secure processing and fail-safe handling for unsupported structures.",
    primaryCta: {
      href: "/app/upload",
      label: "View Upload Preview",
    },
    secondaryCta: {
      href: "#faq",
      label: "See FAQ",
    },
  },
  trust: {
    title: "Temporary processing trust model",
    intro:
      "The primary upload workflow uses temporary server-side processing with short retention and explicit deletion behavior.",
    highlights: [
      {
        title: "Temporary storage only",
        description:
          "Uploaded files are stored only for analysis, cleanup, and artifact generation.",
      },
      {
        title: "Deletion after download or expiry",
        description:
          "Files are intended to be deleted after download or short expiry windows.",
      },
      {
        title: "No training on uploaded files",
        description:
          "Uploaded file contents are not used for model training.",
      },
      {
        title: "Compatibility is workflow-specific",
        description:
          "Object-level cleanup works only for supported structures; unsupported structures fail safely.",
      },
    ],
    note: "Current status: early temporary-processing beta. No permanent archive is intended.",
    primaryCta: {
      href: "/app/upload",
      label: "Open Temporary Upload Workflow",
    },
    secondaryCta: {
      href: "/privacy-policy",
      label: "Read Privacy Policy",
    },
  },
  benefits: {
    title: "Why teams use PPTWatermarkRemover",
    intro:
      "Designed for teams that need cleaner presentation files while staying thoughtful about privacy and review workflows.",
    items: [
      {
        title: "Reduce repetitive editing work",
        description:
          "Handle repeated cleanup tasks in supported scenarios such as common logos, headers, and brand marks.",
      },
      {
        title: "Protect sharing quality",
        description:
          "Make shared decks more polished for client reviews, internal handoffs, and external presentations.",
      },
      {
        title: "Built for practical compatibility",
        description:
          "Focused on realistic PPT and PDF cleanup workflows where compatibility can be clearly defined.",
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
    title: "How rollout works",
    intro:
      "Current rollout is focused on temporary processing reliability, trust transparency, and supported-case expansion.",
    steps: [
      {
        title: "Upload to temporary job",
        description:
          "Upload a PDF to temporary storage for server-side analysis.",
      },
      {
        title: "Review candidates and apply",
        description:
          "Select supported candidates, confirm scope, and run cleanup apply.",
      },
      {
        title: "Download and auto-expire",
        description:
          "Download cleaned PDF and report. Files are deleted after download or short expiry.",
      },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    items: [
      {
        question: "Do you upload my PPT or PDF to your servers?",
        answer:
          "Yes, in the current primary workflow, uploaded files are processed in temporary server-side job storage.",
      },
      {
        question: "How long are uploaded files stored?",
        answer:
          "Files are intended to be deleted after download or short expiry, and we do not intend to keep a long-term archive.",
      },
      {
        question: "Is this 100% secure?",
        answer:
          "No online service can promise 100% security or zero risk. We use temporary retention and practical safeguards, and users should still apply their own data-handling judgment.",
      },
      {
        question: "What file types and workflows are you targeting?",
        answer:
          "We currently focus on supported object-level cleanup scenarios in PDF uploads, such as repeated logos, headers, footers, and repeated brand marks. Compatibility depends on file structure.",
      },
      {
        question: "Can this clean every watermark in every file?",
        answer:
          "No. Unsupported or flattened structures may fail safely instead of forcing destructive edits.",
      },
    ],
  },
  finalCta: {
    title: "Need temporary-processing PDF cleanup?",
    description:
      "Use the upload workflow to analyze candidates and run supported object-level cleanup, then download outputs before temporary expiry.",
    primaryCta: {
      href: "/app/upload",
      label: "Go to Upload Workspace",
    },
    secondaryCta: {
      href: "/contact",
      label: "Contact Us",
    },
  },
};
