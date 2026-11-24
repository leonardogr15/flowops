/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development: session cookie + CSRF work exactly as behind nginx.
    proxy: { "/api": apiTarget, "/admin": apiTarget, "/static": apiTarget },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: { provider: "v8", include: ["src/**/*.{ts,tsx}"], exclude: ["src/api/schema.d.ts", "src/test/**", "src/main.tsx"] },
  },
});
