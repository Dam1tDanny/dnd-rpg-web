import { defineConfig } from "vite";
import base from "./vite.config";

// Single-file build for quick shareable hosting: inlines all JS/CSS as
// base64 so dist-singlefile/index.html runs standalone.
export default defineConfig({
  ...(base as object),
  base: "./",
  build: {
    outDir: "dist-singlefile",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
  },
});
