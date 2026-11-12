import { defineConfig } from "vite";

// API_PORT lets a second checkout run its own wrangler (e.g. 8846) next to the default one on 8845.
const apiPort = process.env.API_PORT || "8845";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("lightweight-charts")) return "charts";
          if (id.includes("react") || id.includes("react-router")) return "vendor";
        },
      },
    },
  },
});
