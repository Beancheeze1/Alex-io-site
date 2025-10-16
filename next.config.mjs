// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Use in-memory cache to dodge Windows rename/lock issues during setup
    config.cache = { type: "memory" };
    return config;
  },
};

module.exports = nextConfig;
