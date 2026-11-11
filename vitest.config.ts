import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as NextEnv from "@next/env";
import { defineConfig } from "vitest/config";

// @next/env is the same loader Next.js uses; more lenient than Node's
// native --env-file (which silently drops some lines containing `:` etc).
// CommonJS require because @next/env doesn't ship ESM named exports.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof NextEnv;

// @next/env deliberately SKIPS `.env.local` when NODE_ENV === "test" (so
// production-like tests stay clean). Vitest sets NODE_ENV=test by default,
// which would lock us out of the developer's .env.local. Override before
// loading, then restore — RLS tests must run against the developer's local
// Supabase project, not against a hypothetical `.env.test`.
//
// process.env.NODE_ENV is typed as readonly in newer @types/node, so we cast
// to a mutable record for the override window.
const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;
env.NODE_ENV = "development";
loadEnvConfig(process.cwd());
if (savedNodeEnv === undefined) {
  delete env.NODE_ENV;
} else {
  env.NODE_ENV = savedNodeEnv;
}

const testEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => typeof v === "string"),
) as Record<string, string>;

export default defineConfig({
  // Tests import a few mobile/src files. Without this, oxc loads mobile/tsconfig.json, which extends
  // expo/tsconfig.base, and that is installed only by the Mobile job, so those files fail to transform.
  oxc: { tsconfig: false },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
      "@patient-core": resolve(__dirname, "./packages/patient-core"),
      // Stub Next's `server-only` package — not resolvable outside Next's
      // bundler. Production builds enforce the boundary at compile time.
      "server-only": resolve(__dirname, "./tests/_stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    env: testEnv,
    // RLS + encryption tests hit live Supabase; serial keeps test users from
    // tripping over each other on the free-tier auth.admin rate limits.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
