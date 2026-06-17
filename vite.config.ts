import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // In Bolt preview mode (npm run dev), there is no Express backend.
  // In dev:full mode the Express server runs on PORT (default 5000) and Vite
  // is started as middleware by Express — no proxy needed.
  const isBoltPreview = process.env.VITE_BOLT_PREVIEW === "true";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      // When NOT in Bolt mode and running Vite standalone, proxy /api to Express.
      // (In Bolt mode there is no Express; all reads go to Supabase via api.ts.)
      ...(isBoltPreview
        ? {}
        : {
            proxy: {
              "/api": {
                target: `http://localhost:${process.env.BACKEND_PORT || 5001}`,
                changeOrigin: true,
              },
              "/uploads": {
                target: `http://localhost:${process.env.BACKEND_PORT || 5001}`,
                changeOrigin: true,
              },
            },
          }),
    },
  };
});
