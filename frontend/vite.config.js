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
      const ts = String(Date.now());
      const stamped = fs.readFileSync(swPath, "utf-8").replace("__SW_VERSION__", ts);
      fs.writeFileSync(swPath, stamped);
      console.log(`SW version stamp: ${ts}`);
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
