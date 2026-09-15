import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { assetsInlineLimit: 0 },
  // MACHINIST_API points the dev server at a control plane other than the
  // default local one, which is how a branch is reviewed without touching it.
  server: { proxy: { "/api": process.env.MACHINIST_API || "http://127.0.0.1:7331" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
