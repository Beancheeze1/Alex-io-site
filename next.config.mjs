// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: remove static export; keep a server build so /api/* works.
  reactStrictMode: true,
};

export default nextConfig;
