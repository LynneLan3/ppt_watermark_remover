import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

const publicRoutes = [
  "/",
  "/contact",
  "/gamma-watermark-remover",
  "/notebooklm-watermark-remover",
  "/ppt-watermark-remover",
  "/remove-watermark-from-powerpoint",
  "/privacy-policy",
  "/terms",
  "/disclaimer",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${siteConfig.url}${route}`,
    lastModified: new Date(),
  }));
}
