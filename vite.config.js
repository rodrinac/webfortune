import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { googleTagBootstrap, googleTagSnippet } from "./web/analytics.js";

// Same file the Worker compiles in, so the E2E CSP cannot drift from production.
function htmlSecurityHeaders() {
  const text = readFileSync(
    new URL("./worker/html-security-headers.txt", import.meta.url),
    "utf8",
  );
  const headers = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid security header: ${trimmed}`);
    }
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!name || !value) throw new Error(`Invalid security header: ${trimmed}`);
    headers[name] = value;
  }
  return headers;
}

function googleAnalyticsPlugin(measurementId) {
  const bootstrap = googleTagBootstrap(measurementId);
  const snippet = googleTagSnippet(measurementId);
  const serveBootstrap = (request, response, next) => {
    const path = (request.url || "").split("?")[0];
    if (path !== "/gtag-bootstrap.js") return next();
    if (!bootstrap) return next();
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(bootstrap);
  };
  return {
    name: "google-analytics-tag",
    transformIndexHtml(html) {
      if (!snippet) return html;
      return html.replace("</head>", `${snippet}\n</head>`);
    },
    configureServer(server) {
      server.middlewares.use(serveBootstrap);
    },
    generateBundle() {
      if (!bootstrap) return;
      this.emitFile({
        type: "asset",
        fileName: "gtag-bootstrap.js",
        source: bootstrap,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const id = process.env.VITE_GA_MEASUREMENT_ID || env.VITE_GA_MEASUREMENT_ID || "";
  const securityHeaders = htmlSecurityHeaders();
  return {
    plugins: [tailwindcss(), googleAnalyticsPlugin(id)],
    root: "web",
    base: "./",
    build: { outDir: "../dist", emptyOutDir: true },
    server: {
      headers: securityHeaders,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          rewrite: (path) => path.replace(/^\/api/, "") || "/",
        },
      },
    },
    preview: { headers: securityHeaders },
  };
});
