import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const alias = {
  "@shared": resolve(__dirname, "src/shared"),
};

/**
 * The CSP <meta> tag in index.html protects the packaged app. The dev server needs inline
 * scripts for React hot reload, so the tag is removed only while running `npm run dev`.
 */
function stripCspInDev(): Plugin {
  return {
    name: "ezlauncher:strip-csp-in-dev",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/, ""),
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [stripCspInDev(), react(), tailwindcss()],
    build: { minify: true },
  },
});
