import { defineConfig } from "vite";

const server = process.env.PIXEL_OFFICE_DEV_SERVER ?? "http://127.0.0.1:8790";

export default defineConfig({
  server: {
    port: 5173,
    // No changeOrigin: the server's WebSocket check requires Origin host == Host.
    proxy: {
      "/ws": { target: server, ws: true },
      "/api": server,
      "/login": server,
      "/logout": server,
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
