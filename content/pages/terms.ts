import type { PolicySection } from "@/content/types/policy";

export type TermsContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const termsContent: TermsContent = {
  title: "Terms of Use",
  lastUpdated: "April 20, 2026",
  intro:
    "These Terms of Use govern access to and use of the NotebookLM Watermark Remover website.",
  sections: [
    {
      title: "Acceptance of Terms",
      paragraphs: [
        "By using this site, you agree to these Terms of Use and applicable laws.",
        "If you do not agree with these terms, do not use the site.",
      ],
    },
    {
      title: "Current Service Stage",
      paragraphs: [
        "NotebookLM Watermark Remover currently provides a temporary upload, preview-first cleanup workflow for exported presentation files.",
        "The product remains early-stage/beta and is continuously evolving.",
        "We do not provide account-based storage, paid plans, or permanent document library functionality at this stage.",
      ],
    },
    {
      title: "Permitted Use",
      paragraphs: [
        "You may use this site for lawful informational purposes and to use supported cleanup workflows.",
        "You agree not to misuse the site, attempt unauthorized access, disrupt service availability, or submit unlawful content.",
      ],
    },
    {
      title: "User Responsibility",
      paragraphs: [
        "You are responsible for the accuracy of information you provide through contact forms, email, or related communication channels.",
        "You are responsible for ensuring that files you upload and process are lawful and do not violate third-party rights.",
        "You are responsible for downloading any needed output before temporary data expires or is deleted.",
      ],
    },
    {
      title: "Intellectual Property",
      paragraphs: [
        "Site content, branding, and materials are owned by NotebookLM Watermark Remover or its licensors unless otherwise noted.",
        "You may not copy, republish, or distribute site materials beyond reasonable personal or internal reference without permission.",
      ],
    },
    {
      title: "No Warranty",
      paragraphs: [
        "The site is provided on an as-is and as-available basis without warranties of any kind, to the extent permitted by law.",
        "We do not warrant that every exported file structure is supported or that cleanup succeeds for every file.",
      ],
    },
    {
      title: "Limitation of Liability",
      paragraphs: [
        "To the maximum extent permitted by law, NotebookLM Watermark Remover is not liable for indirect, incidental, special, or consequential damages arising from site use.",
      ],
    },
    {
      title: "Changes to Terms",
      paragraphs: [
        "We may update these terms as the product and website evolve. Continued use after updates constitutes acceptance of the revised terms.",
      ],
    },
    {
      title: "Contact",
      paragraphs: [
        "For terms-related questions, contact: hello@pptwatermarkremover.com.",
      ],
    },
  ],
};
