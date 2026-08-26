import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` and `next build` share .next by default, so running a build
  // while the dev server is up clobbers its chunks (symptoms: long recompiles,
  // a hard reload, and an unstyled page because the CSS chunk 404s). Set
  // NEXT_DIST_DIR to build into a separate directory instead.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
