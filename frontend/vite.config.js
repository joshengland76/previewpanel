import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

function swVersionPlugin() {
  return {
    name: "sw-version",
    closeBundle() {
      const swPath = path.resolve("dist/sw.js");
      if (!fs.existsSync(swPath)) return;
      const stamped = fs.readFileSync(swPath, "utf-8").replace("__SW_VERSION__", String(Date.now()));
      fs.writeFileSync(swPath, stamped);
    },
  };
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        timeout: 0,          // disables socket inactivity timeout
        proxyTimeout: 600000, // 10 min for large uploads to reach Express
      },
    },
  },
});
