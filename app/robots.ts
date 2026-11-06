import type { MetadataRoute } from "next";
// Step 48: point crawlers (Bing, Google, ChatGPT search) at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://api.alex-io.com/sitemap.xml",
  };
}
