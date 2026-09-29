import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

const nodeBuiltins = [
  "fs",
  "path",
  "os",
  "child_process",
  "crypto",
  "net",
  "http",
  "https",
];

export default tseslint.config(
  { ignores: ["out/**", "release/**", "coverage/**", "node_modules/**"] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["eslint.config.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Tests may assert on values they just checked.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },

  // Main process, preload and shared code run in Node.
  {
    files: [
      "src/main/**/*.ts",
      "src/preload/**/*.ts",
      "src/shared/**/*.ts",
      "*.config.ts",
    ],
    languageOptions: { globals: globals.node },
  },

  // Core logic must stay testable without Electron.
  {
    files: [
      "src/main/core/**/*.ts",
      "src/main/minecraft/**/*.ts",
      "src/main/auth/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message: "core/, minecraft/ and auth/ must not import Electron.",
            },
          ],
        },
      ],
    },
  },

  // Renderer: React UI only, no Node or Electron access.
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message:
                "The renderer talks to the main process via window.api only.",
            },
            ...nodeBuiltins.map((name) => ({
              name,
              message: "No Node APIs in the renderer.",
            })),
          ],
          patterns: [
            { group: ["node:*"], message: "No Node APIs in the renderer." },
            {
              group: ["**/main/**", "**/preload/**"],
              message: "Import shared types from @shared instead.",
            },
          ],
        },
      ],
    },
  },

  prettier,
);
