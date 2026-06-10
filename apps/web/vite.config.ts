import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// v2-core — 단일 화면이라 manualChunks 불필요. 무거워지면 그때 다시 나눈다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3201,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3200",
        changeOrigin: true,
      },
    },
  },
});
