import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["electron/**/*.js", "scripts/**/*.cjs", "*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "release/**",
    "public/pdfjs/**",
    "public/pdf.worker*.js",
    "public/pdf.worker*.mjs",
    ".build-cache/**",
    "next-env.d.ts",
    "src/frozen/**",
  ]),
]);

export default eslintConfig;
