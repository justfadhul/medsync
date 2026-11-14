import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Gate H (ADR 0094, PRD §4.5): the two surfaces a patient or a desk clerk
    // meets on a phone get jsx-a11y's strict set as errors. eslint-config-next
    // already registers the plugin (at "warn", a handful of rules); this only
    // widens the rule set for these trees, so the plugin is not re-declared.
    files: [
      "app/patient/**/*.{ts,tsx}",
      "app/reception/**/*.{ts,tsx}",
      // NCDSync (§11.5): every screen keyboard-operable with labelled inputs.
      "app/ncd/**/*.{ts,tsx}",
      "app/ncd-offline/**/*.{ts,tsx}",
    ],
    rules: jsxA11y.flatConfigs.strict.rules,
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "next-env.d.ts",
    // The Expo app has its own eslint config, RN globals and plugin set.
    "mobile/**",
    // The rework kit's clickable prototype: reference only, never shipped (MEDICINES-TAB.md §20).
    "docs/pharmacy/rework/prototype/**",
    // Self-contained Vite subproject with its own toolchain.
    "bionic-islet-bench/**",
    // The local PGlite and screenshot harness (not a dependency, ADR 0133).
    ".emr-harness/**",
    // Static assets served verbatim, including the sensor bench's built
    // bundle. Never source, never linted.
    "public/**",
  ]),
]);

export default eslintConfig;
