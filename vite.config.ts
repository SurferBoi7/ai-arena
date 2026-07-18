import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// We read the repo name from the VITE_BASE_PATH env var (set in the workflow),
// defaulting to "/" for local dev. The workflow sets VITE_BASE_PATH="/<repo>/".
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Local dev: the Settings "Send Test Digest Now" button calls /api/...
      // which is proxied to the small dispatch server on port 8787.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
});
