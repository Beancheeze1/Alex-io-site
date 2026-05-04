import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production output (best for Docker / hosting platforms)
  output: "standalone",

  // Core security & performance
  reactStrictMode: true,
  poweredByHeader: false,

  // Image optimization — restrict to known trusted domains only.
  // Add specific hostnames here rather than using a wildcard (SSRF risk).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "alex-io.com",
      },
    ],
  },

  // Security headers (applied to every route)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;