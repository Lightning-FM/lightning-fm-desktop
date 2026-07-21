import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appendFileSync } from "node:fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Dev-server sink for the automated validation runner (src/dev/validate.ts).
// The runner POSTs JSON progress lines here; they append to LFM_VALIDATE_OUT
// so a headless orchestrator outside the webview can follow along.
const validateReport = (): Plugin => ({
  name: "lfm-validate-report",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__lfm-validate-report", (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        // @ts-expect-error process is a nodejs global
        const out = process.env.LFM_VALIDATE_OUT;
        if (out) {
          try {
            appendFileSync(out, body + "\n");
          } catch (e) {
            console.error("[lfm-validate-report] append failed:", e);
          }
        }
        res.end("ok");
      });
    });
  },
});

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), validateReport()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: parseInt(process.env.EEG_PORT_VITE_HMR ?? "1420", 10),
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
