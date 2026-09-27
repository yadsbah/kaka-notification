import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the SPA runs on :5173 and proxies the API, so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
