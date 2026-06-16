import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// Next 15's ESLint integration uses the classic "extends" presets bridged into
// flat config via FlatCompat (this is what create-next-app generates for v15).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Flat config doesn't ignore build output by default — exclude it so ESLint
  // only checks our source, not the generated .next bundle.
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
