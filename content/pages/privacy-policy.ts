export type PolicySection = {
  title: string;
  paragraphs: string[];
};

export type PrivacyPolicyContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const privacyPolicyContent: PrivacyPolicyContent = {
  title: "Privacy Policy",
  lastUpdated: "April 18, 2026",
  intro:
    "This Privacy Policy describes how PPTWatermarkRemover collects and uses information for the current Stage 1 marketing website.",
  sections: [
    {
      title: "Stage 1 Service Scope",
      paragraphs: [
        "PPTWatermarkRemover is currently a marketing and contact site. The live site does not provide production file upload or automated file processing at this stage.",
        "Because Stage 1 does not include backend cleanup workflows, we do not process presentation file content as part of a live cleanup service yet.",
      ],
    },
    {
      title: "Information We Collect",
      paragraphs: [
        "If you contact us, we may collect the details you provide, such as your name, email address, company, and workflow notes.",
        "We may also receive basic technical information from normal website operation, such as browser and device context, through standard hosting and server logs.",
      ],
    },
    {
      title: "How We Use Information",
      paragraphs: [
        "We use submitted contact information to respond to requests, understand demand, and communicate early access updates related to PPTWatermarkRemover.",
        "We may use aggregated, non-identifying information to improve site content, messaging, and future product direction.",
      ],
    },
    {
      title: "Data Sharing",
      paragraphs: [
        "We do not sell personal information.",
        "We may share information with service providers that help operate the site and communication workflows, subject to appropriate confidentiality and security practices.",
      ],
    },
    {
      title: "Data Retention",
      paragraphs: [
        "We retain contact submissions for as long as reasonably needed to respond, manage early access interest, and support legitimate business operations.",
        "You can request deletion of your contact data by emailing hello@pptwatermarkremover.com.",
      ],
    },
    {
      title: "Future Updates",
      paragraphs: [
        "As the product evolves beyond Stage 1, this policy may change to reflect new functionality such as file processing or additional services.",
        "When we make material updates, we will revise the Last Updated date on this page.",
      ],
    },
    {
      title: "Contact",
      paragraphs: [
        "For privacy questions, contact: hello@pptwatermarkremover.com.",
      ],
    },
  ],
};
