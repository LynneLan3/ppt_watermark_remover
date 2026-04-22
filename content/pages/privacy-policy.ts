import type { PolicySection } from "@/content/types/policy";

export type PrivacyPolicyContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

export const privacyPolicyContent: PrivacyPolicyContent = {
  title: "Privacy Policy",
  lastUpdated: "April 20, 2026",
  intro:
    "This Privacy Policy describes how NotebookLM Watermark Remover handles information for the temporary upload, preview-first workflow, and related website pages.",
  sections: [
    {
      title: "Service Scope",
      paragraphs: [
        "NotebookLM Watermark Remover provides a focused cleanup workflow for exported presentation files.",
        "Current product behavior is upload -> temporary processing -> preview -> download -> deletion after download or short expiry.",
      ],
    },
    {
      title: "Temporary Processing and Retention",
      paragraphs: [
        "Uploaded files are stored in temporary job storage for processing and artifact generation.",
        "Uploaded source files and generated artifacts are intended to be deleted after download or short expiry.",
        "We do not intend to maintain a permanent archive of uploaded files.",
      ],
    },
    {
      title: "Information We Collect",
      paragraphs: [
        "File contents: When you use the upload workflow, file contents are processed on server infrastructure in temporary storage.",
        "Contact information: If you contact us, we may collect information you provide, such as name, email address, and cleanup workflow details.",
        "Technical and operational logs: Like most websites, we may receive standard hosting and server log data such as IP address, browser type, device context, timestamps, and request metadata.",
      ],
    },
    {
      title: "How We Use Information",
      paragraphs: [
        "We use uploaded files to perform requested analysis and cleanup processing and to generate downloadable artifacts.",
        "We do not use uploaded file contents to train machine learning models.",
        "We use contact information to respond to requests and understand demand for supported cleanup workflows.",
        "We use technical and operational data to operate, secure, and improve the site and preview experience.",
      ],
    },
    {
      title: "Data Sharing",
      paragraphs: [
        "We do not sell personal information.",
        "We may share information with service providers that help us run hosting, communication, and operational systems, subject to contractual and security controls.",
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "Temporary processing files are intended to be deleted after download or short expiry windows.",
        "We retain contact submissions and related communications for as long as reasonably necessary to support business operations and user requests.",
        "Operational logs are retained according to hosting and security practices and may vary by provider.",
        "You can request deletion of contact data by emailing hello@pptwatermarkremover.com, subject to legal and operational obligations.",
      ],
    },
    {
      title: "Security and Risk Notice",
      paragraphs: [
        "We use reasonable safeguards for temporary processing workflows, but no online service can promise 100% security or zero risk.",
        "Users should apply their own judgment when handling sensitive materials and avoid relying on absolute security guarantees.",
      ],
    },
    {
      title: "Future Updates",
      paragraphs: [
        "As we introduce additional functionality, including possible cloud-based or expanded processing features, this policy may be updated.",
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
