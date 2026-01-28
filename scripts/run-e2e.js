#!/usr/bin/env node

/* eslint-disable no-console */
const { spawn } = require("child_process");
const path = require("path");
const getPortModule = require("get-port");
const waitOn = require("wait-on");

const ROOT = path.resolve(__dirname, "..");
const PREFERRED_PORTS = [3000, 3001, 3002, 3003];
const DEV_COMMAND = ["run", "dev"];

async function main() {
  const pickPort = typeof getPortModule === "function" ? getPortModule : getPortModule.default;
  const port = await pickPort({ port: PREFERRED_PORTS });
  const baseURL = `http://localhost:${port}`;

  console.log(`[e2e] starting dev server on ${baseURL}`);
  const dev = spawn("npm", [...DEV_COMMAND, "--", "--port", String(port)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const cleanup = () => {
    if (!dev.killed) {
      dev.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("exit", cleanup);

  try {
    await waitOn({
      resources: [`http-get://localhost:${port}`],
      timeout: 60_000,
      interval: 500,
    });
    console.log("[e2e] dev server is ready, running Playwright");

    const result = spawn(
      "npx",
      ["playwright", "test"],
      {
        cwd: ROOT,
        env: { ...process.env, E2E_BASE_URL: baseURL },
        stdio: "inherit",
        shell: process.platform === "win32",
      }
    );

    result.on("exit", (code) => {
      cleanup();
      process.exit(code ?? 1);
    });
  } catch (err) {
    console.error("[e2e] failed to start dev server", err);
    cleanup();
    process.exit(1);
  }
}

main();
