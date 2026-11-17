import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // OMR engine is pure TypeScript (runs in a Web Worker), no native deps.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
