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
  //
  // /embed/* pages are meant to be framed by arbitrary third-party tenant
  // websites (the whole point of the embeddable widget), so they must be
  // excluded from the site-wide X-Frame-Options: DENY / restrictive CSP
  // frame-ancestors below. Next.js applies header values as a plain
  // per-key overwrite in match order (not additive/removable), so the only
  // reliable way to keep XFO off of /embed/* is to exclude it from the
  // general rule's source pattern entirely — a later rule re-declaring
  // X-Frame-Options with some other value would NOT unset an XFO already
  // applied by an earlier matching rule for the same path.
  async headers() {
    return [
      {
        // Everything except /embed and /embed/*
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://googleads.g.doubleclick.net https://www.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://googleads.g.doubleclick.net https://www.google.com; frame-ancestors 'self';",
          },
        ],
      },
      {
        // Embeddable widget pages: allow framing from any tenant's own site.
        // No X-Frame-Options here on purpose (see note above).
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // NOTE: a bare "*" host-source does NOT match the https: scheme
            // for frame-ancestors in current browsers (confirmed via a real
            // console error: "Framing '...' violates CSP directive:
            // 'frame-ancestors *'. The scheme 'https:' must be added
            // explicitly."). Per the CSP spec, https:/http: are
            // <scheme-source> tokens (bare scheme + required colon, no
            // "//" or host) — listing them explicitly is the correct,
            // unambiguous way to allow framing from any origin over either
            // scheme, instead of relying on the wildcard host-source.
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self'; frame-ancestors https: http:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;