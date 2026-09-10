/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Preload the Latin cuts of the three fonts.
 *
 * Without this the page paints in the fallback face and reflows when the real
 * one arrives, which measured as 0.149 of cumulative layout shift on the
 * overview. The files are hashed at build time, so the tags are written from
 * the emitted bundle rather than guessed.
 */
function preloadLatinFonts(): PluginOption {
  const wanted = /-latin-wght-normal-[^.]+\.woff2$/;
  let hrefs: string[] = [];

  return {
    name: "preload-latin-fonts",
    apply: "build",
    generateBundle(_options, bundle) {
      hrefs = Object.keys(bundle)
        .filter((name) => wanted.test(name))
        .sort()
        .map((name) => `./${name}`);
    },
    transformIndexHtml() {
      return hrefs.map((href) => ({
        tag: "link",
        attrs: { rel: "preload", as: "font", type: "font/woff2", href, crossorigin: "" },
        injectTo: "head" as const,
      }));
    },
  };
}

// base: './' keeps every asset reference relative, so the same static bundle
// serves from a domain root (Vercel) and from a sub-path (GitHub Pages).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), preloadLatinFonts()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
