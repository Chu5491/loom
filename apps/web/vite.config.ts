import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 캐시 친화적 vendor 분할 — 라이브러리 업데이트 안 한 사이엔 vendor 청크가 stale-while-revalidate.
// 그룹화 기준: 자주 함께 쓰이는 라이브러리(react/router/query)와 무거운 단일 라이브러리(motion).
const VENDOR_CHUNKS: Record<string, RegExp> = {
  "vendor-react": /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//,
  "vendor-query": /node_modules\/@tanstack\//,
  "vendor-radix": /node_modules\/@radix-ui\//,
  "vendor-motion": /node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//,
  "vendor-icons": /node_modules\/(lucide-react|@lobehub\/icons)\//,
  "vendor-markdown": /node_modules\/(marked)\//,
  "vendor-toast": /node_modules\/(sonner|cmdk|vaul)\//,
};

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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [name, re] of Object.entries(VENDOR_CHUNKS)) {
            if (re.test(id)) return name;
          }
          return undefined;
        },
      },
    },
  },
});
