import { hostname } from "node:os";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createCodexBridgeMiddleware } from "./src/server/codexAppServerBridge";
import tailwindcss from "@tailwindcss/vite";

function readAllowedHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

function getDevAllowedHosts(): string[] {
  const machineName = hostname().trim();
  const shortMachineName = machineName.split(".")[0] ?? "";
  return Array.from(
    new Set(
      [
        machineName,
        machineName.toLowerCase(),
        shortMachineName,
        shortMachineName.toLowerCase(),
        ...readAllowedHosts(process.env.VITE_ALLOWED_HOSTS ?? process.env.ALLOWED_HOSTS),
      ].filter((host) => host.length > 0),
    ),
  );
}

export default defineConfig({
  server: {
    port: 5173,
    allowedHosts: getDevAllowedHosts(),
  },
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: "codex-bridge",
      configureServer(server) {
        const bridge = createCodexBridgeMiddleware();
        server.middlewares.use(bridge);
        server.httpServer?.once("close", () => {
          bridge.dispose();
        });
      },
    },
  ],
});
