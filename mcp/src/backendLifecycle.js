import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backendConfig } from "./backendClient.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const backendRoot = join(projectRoot, "backend");
const backendEntry = join(backendRoot, "src", "server.js");
const backendEnv = join(backendRoot, ".env");
const dataDir = join(backendRoot, "data");
const pidFile = join(dataDir, "backend.pid");
const logFile = join(dataDir, "backend.log");

function isManagedLocalUrl() {
  try {
    const url = new URL(backendConfig.url);
    const host = url.hostname.toLowerCase();
    return (
      (host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1") &&
      Number(url.port || 80) === 3001 &&
      (url.pathname === "/" || url.pathname === "") &&
      process.env.CODEBASE_MENTOR_AUTO_START_BACKEND !== "false"
    );
  } catch {
    return false;
  }
}

async function healthy() {
  try {
    const response = await fetch(`${backendConfig.url}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.ok === true;
  } catch {
    return false;
  }
}

export async function ensureBackendRunning() {
  if (await healthy()) return;
  if (!isManagedLocalUrl()) return;
  if (!existsSync(backendEntry)) {
    throw new Error(`Codebase Mentor backend was not found at ${backendEntry}. Re-run Install-Codebase-Mentor.bat.`);
  }
  if (!existsSync(join(backendRoot, "node_modules", "express"))) {
    throw new Error("Codebase Mentor dependencies are not installed. Run Install-Codebase-Mentor.bat once.");
  }

  mkdirSync(dataDir, { recursive: true });
  const logHandle = openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [`--env-file-if-exists=${backendEnv}`, "src/server.js"],
    {
      cwd: backendRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: "3001" },
      detached: true,
      stdio: ["ignore", logHandle, logHandle],
      windowsHide: true,
    },
  );
  closeSync(logHandle);
  child.unref();
  child.on("error", (error) => {
    console.error(`[codebase-mentor-mcp] could not launch local backend: ${error.message}`);
  });
  if (child.pid) {
    writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthy()) {
      console.error("[codebase-mentor-mcp] local backend is ready");
      return;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Codebase Mentor backend did not become healthy at ${backendConfig.url}. Check backend/data/backend.log for local diagnostics.`,
  );
}
