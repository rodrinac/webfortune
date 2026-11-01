import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { googleTagSnippet } from "./web/analytics.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const id = process.env.VITE_GA_MEASUREMENT_ID || env.VITE_GA_MEASUREMENT_ID || "";
  return {
    plugins: [
      tailwindcss(),
      {
        name: "google-analytics-tag",
        transformIndexHtml(html) {
          const snippet = googleTagSnippet(id);
          if (!snippet) return html;
          return html.replace("</head>", `${snippet}\n</head>`);
        },
      },
    ],
    root: "web",
    base: "./",
    build: { outDir: "../dist", emptyOutDir: true },
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          rewrite: (path) => path.replace(/^\/api/, "") || "/",
        },
      },
    },
  };
});
