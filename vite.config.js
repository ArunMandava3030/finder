import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SEARCH_MODE": JSON.stringify(
        mode === "pages"
          ? "public"
          : mode === "server"
            ? "server"
            : env.VITE_SEARCH_MODE || "public",
      ),
    },
    server: {
      port: 5173,
      proxy: { "/api": "http://127.0.0.1:3001" },
    },
  };
});
