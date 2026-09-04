import type { MetadataRoute } from "next";
import { siteUrl as resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl();

/** Standing pages linked from the footer. */
const PAGES = ["/privacy", "/terms", "/security", "/api-docs"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: siteUrl,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    ...PAGES.map((path) => ({
      url: `${siteUrl}${path}`,
      lastModified,
      changeFrequency: "yearly" as const,
      priority: 0.4,
    })),
  ];
}
