// app/sitemap.ts
//
// Step 48: /sitemap.xml for search engines and Bing Webmaster Tools.
// Only the public marketing page is listed; shop pages, quotes and admin are
// left out on purpose.
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://api.alex-io.com/landing",
      lastModified: new Date("2026-11-06"),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
