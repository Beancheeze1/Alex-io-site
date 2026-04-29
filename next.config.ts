import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production output (best for Docker / hosting platforms)
  output: "standalone",

  // Core security & performance
  reactStrictMode: true,
  poweredByHeader: false,

  // Image optimization (allow all external images for now)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
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
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;