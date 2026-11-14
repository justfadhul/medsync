import path from "node:path";
import type { NextConfig } from "next";

/** The site builds from this folder but compiles the landing code shared with the hospital app, two levels up. */
const root = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
