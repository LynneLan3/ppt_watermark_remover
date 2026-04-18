import type { PolicySection } from "@/content/pages/privacy-policy";

export type TermsContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const termsContent: TermsContent = {
  title: "Terms of Use",
  lastUpdated: "April 18, 2026",
  intro:
    "These Terms of Use govern access to and use of the PPTWatermarkRemover website.",
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
        "PPTWatermarkRemover is currently a Stage 1 marketing and contact website.",
        "No production upload processing, paid plans, or account-based service is provided through this website at this time.",
      ],
    },
    {
      title: "Permitted Use",
      paragraphs: [
        "You may use this site for lawful informational purposes and to contact us about early access interest.",
        "You agree not to misuse the site, attempt unauthorized access, disrupt service availability, or submit unlawful content.",
      ],
    },
    {
      title: "User Responsibility",
      paragraphs: [
        "You are responsible for the accuracy of information you provide through contact forms, email, or related communication channels.",
        "You are responsible for ensuring that your intended use of any future product features complies with applicable laws and third-party rights.",
      ],
    },
    {
      title: "Intellectual Property",
      paragraphs: [
        "Site content, branding, and materials are owned by PPTWatermarkRemover or its licensors unless otherwise noted.",
        "You may not copy, republish, or distribute site materials beyond reasonable personal or internal reference without permission.",
      ],
    },
    {
      title: "No Warranty",
      paragraphs: [
        "The site is provided on an as-is and as-available basis without warranties of any kind, to the extent permitted by law.",
      ],
    },
    {
      title: "Limitation of Liability",
      paragraphs: [
        "To the maximum extent permitted by law, PPTWatermarkRemover is not liable for indirect, incidental, special, or consequential damages arising from site use.",
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
