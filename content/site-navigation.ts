export type NavigationLink = {
  href: string;
  label: string;
};

type FooterNavigationGroup = {
  title: string;
  links: NavigationLink[];
};

export const footerNavigation = {
  description:
    "NotebookLM export cleanup hub focused on PDF-first watermark removal with temporary processing and auto delete.",
  groups: [
    {
      title: "Product",
      links: [
        {
          href: "/",
          label: "NotebookLM cleanup homepage",
        },
        {
          href: "/ppt-watermark-remover",
          label: "PPT watermark remover tool page",
        },
        {
          href: "/contact",
          label: "Contact support",
        },
      ],
    },
    {
      title: "Cleanup Guides",
      links: [
        {
          href: "/remove-watermark-from-powerpoint",
          label: "Remove watermark from PowerPoint",
        },
        {
          href: "/gamma-watermark-remover",
          label: "Gamma watermark cleanup guide",
        },
        {
          href: "/notebooklm-watermark-remover",
          label: "NotebookLM export cleanup guide",
        },
        {
          href: "/ppt-watermark-remover",
          label: "Fix PPT export watermark issues",
        },
      ],
    },
    {
      title: "Company & Legal",
      links: [
        {
          href: "/privacy-policy",
          label: "Privacy policy",
        },
        {
          href: "/terms",
          label: "Terms of use",
        },
        {
          href: "/disclaimer",
          label: "Disclaimer",
        },
      ],
    },
  ] satisfies FooterNavigationGroup[],
} as const;
