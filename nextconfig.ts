// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd()
  // If you absolutely must ship while stabilizing, you can temporarily add:
  // typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
