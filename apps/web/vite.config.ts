import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves the site from /BET_207/. Override with VITE_BASE for other hosts.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/BET_207/",
  plugins: [react(), tailwindcss()],
  envDir: "../..",
  server: { port: 5207 },
  build: { outDir: "dist", sourcemap: true },
});
