import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — don't bundle it; load it from node_modules.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
