import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/stdio.js", import.meta.url));
const nodePath = process.execPath;
const target = (process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "all").toLowerCase();
const useHttp = process.argv.includes("--http");
const httpUrl = process.env.MCP_HTTP_URL || `http://127.0.0.1:${process.env.MCP_HTTP_PORT || 3921}/mcp`;
const apiUrl = process.env.CODEBASE_MENTOR_API_URL?.trim() || "";
const stdioEnv = apiUrl ? { CODEBASE_MENTOR_API_URL: apiUrl } : null;

const json = (value) => JSON.stringify(value, null, 2);

const codex = () => {
  if (useHttp)
    return `[mcp_servers.codebase_mentor]\nurl = ${JSON.stringify(httpUrl)}\nbearer_token_env_var = "MCP_HTTP_TOKEN"\nstartup_timeout_sec = 10\ntool_timeout_sec = 60\nenabled = true`;
  const lines = [
    "[mcp_servers.codebase_mentor]",
    `command = ${JSON.stringify(nodePath)}`,
    `args = [${JSON.stringify(serverPath)}]`,
  ];
  if (stdioEnv)
    lines.push(`env = { CODEBASE_MENTOR_API_URL = ${JSON.stringify(apiUrl)} }`);
  lines.push("startup_timeout_sec = 10", "tool_timeout_sec = 60", "enabled = true");
  return lines.join("\n");
};

const configs = {
  codex,
  claude: () => json({
    mcpServers: {
      codebase_mentor: useHttp
        ? { type: "http", url: httpUrl, headers: { Authorization: "Bearer ${MCP_HTTP_TOKEN}" } }
        : { type: "stdio", command: nodePath, args: [serverPath], ...(stdioEnv ? { env: stdioEnv } : {}) },
    },
  }),
  opencode: () => json({
    $schema: "https://opencode.ai/config.json",
    mcp: {
      servers: {
        codebase_mentor: useHttp
          ? {
              type: "remote",
              url: httpUrl,
              headers: { Authorization: "Bearer {env:MCP_HTTP_TOKEN}" },
              oauth: false,
              codemode: false,
            }
          : { type: "local", command: [nodePath, serverPath], ...(stdioEnv ? { environment: stdioEnv } : {}), codemode: false },
      },
    },
  }),
  cursor: () => json({
    mcpServers: {
      codebase_mentor: useHttp
        ? { url: httpUrl, headers: { Authorization: "Bearer ${env:MCP_HTTP_TOKEN}" } }
        : { type: "stdio", command: nodePath, args: [serverPath], ...(stdioEnv ? { env: stdioEnv } : {}) },
    },
  }),
  generic: () => json({
    mcpServers: {
      codebase_mentor: useHttp
        ? { type: "http", url: httpUrl, headers: { Authorization: "Bearer ${MCP_HTTP_TOKEN}" } }
        : { type: "stdio", command: nodePath, args: [serverPath], ...(stdioEnv ? { env: stdioEnv } : {}) },
    },
  }),
};

const locations = {
  codex: "~/.codex/config.toml or a trusted project's .codex/config.toml",
  claude: ".mcp.json at the project root, or `claude mcp add-json codebase_mentor '<entry>'`",
  opencode: "opencode.json (project) or ~/.config/opencode/opencode.json (global); OpenCode 2.x uses mcp.servers",
  cursor: ".cursor/mcp.json (project) or ~/.cursor/mcp.json (global)",
  generic: "your MCP client's mcpServers configuration",
};

if (target !== "all" && !configs[target]) {
  console.error(`Unknown target: ${target}\nUse one of: ${Object.keys(configs).join(", ")}, all`);
  process.exit(1);
}

const selected = target === "all" ? Object.keys(configs) : [target];
for (const name of selected) {
  if (selected.length > 1) console.log(`\n# ${name} — merge into ${locations[name]}`);
  else console.log(`# Merge this entry into ${locations[name]}. Do not replace the existing file.`);
  if (useHttp && name === "codex") console.log("# Set MCP_HTTP_TOKEN in the environment that launches Codex.");
  console.log(configs[name]());
  if (name === "opencode") console.log("\n# OpenCode 2.x shape. For OpenCode 1.x, place the entry directly under `mcp` and replace `codemode`/`disabled` with `enabled`.");
  if (name === "opencode" && useHttp) console.log("# OpenCode variable syntax: {env:MCP_HTTP_TOKEN}");
  if (name === "cursor" && useHttp) console.log("\n# Cursor variable syntax: ${env:MCP_HTTP_TOKEN}");
  if (name === "claude" && useHttp) console.log("\n# Claude Code variable syntax: ${MCP_HTTP_TOKEN}");
}
console.log(
  useHttp
    ? "\n# Streamable HTTP examples. Start the MCP HTTP server with MCP_HTTP_TOKEN set and CODEBASE_MENTOR_API_URL pointing at the backend."
    : `\n# STDIO examples. Start the Codebase Mentor backend first${apiUrl ? ` at ${apiUrl}` : " (default http://127.0.0.1:3001)"}, or set CODEBASE_MENTOR_API_URL for a hosted API.`,
);
if (!useHttp)
  console.log("# If the backend requires a token, add CODEBASE_MENTOR_API_TOKEN to the harness environment or the entry's env block.");
console.log("# Restart or reconnect the harness after merging. The MCP server does not need the web UI to be open.");
