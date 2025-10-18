// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: API routes require a server build. Do NOT use static export.
  // If you previously had: output: 'export', remove it.
  reactStrictMode: true,
  // No "distDir: 'out'", no "output: 'export'".
};

module.exports = nextConfig;
