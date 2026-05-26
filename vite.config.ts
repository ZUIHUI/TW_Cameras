import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8787";

  return {
    root: path.join(workspaceRoot, "apps/web"),
    envDir: workspaceRoot,
    plugins: [react()],
    build: {
      outDir: path.join(workspaceRoot, "dist"),
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
