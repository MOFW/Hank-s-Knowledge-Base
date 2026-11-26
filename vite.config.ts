import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import localStorageConfig from "./db/wrangler.local.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";
import { importValidator } from "./scripts/vite/import-validator.mjs";
import { vinextNavigationFailure } from "./scripts/vite/vinext-navigation-failure.mjs";

const { d1, r2 } = hostingConfig;
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const isDev = command === "serve";
  const localIdentity = isDev && !managedLinux;
  const persistPath = process.env.HKB_LOCAL_STATE;

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : { host: "127.0.0.1" }),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      vinextNavigationFailure(),
      sites({ mockAuth: localIdentity }),
      connectorPreview(),
      importValidator(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        persistState: persistPath ? { path: persistPath } : true,
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: d1 ? [{
            binding: d1,
            database_name: localStorageConfig.d1_databases[0].database_name,
            database_id: localStorageConfig.d1_databases[0].database_id,
          }] : [],
          r2_buckets: r2 ? [{
            binding: r2,
            bucket_name: localStorageConfig.r2_buckets[0].bucket_name,
          }] : [],
          ...(localIdentity ? { vars: {
            HKB_LOCAL_AUTH_MODE: "portable-loopback",
            ...(process.env.HKB_MCP_TOKEN ? { HKB_MCP_TOKEN: process.env.HKB_MCP_TOKEN } : {}),
            ...(process.env.HKB_MCP_OWNER_SUBJECT ? { HKB_MCP_OWNER_SUBJECT: process.env.HKB_MCP_OWNER_SUBJECT } : {}),
          } } : {}),
          ...(isDev ? {
            services: [{ binding: "CONNECTORS", service: "sites-connector-preview", entrypoint: "ConnectorPreview" }],
          } : {}),
        },
        ...(isDev ? {
          auxiliaryWorkers: [{
            config: {
              name: "sites-connector-preview",
              main: "./scripts/connector-preview/worker.mjs",
              compatibility_date: "2026-05-15",
            },
          }],
        } : {}),
      }),
    ],
  };
});
