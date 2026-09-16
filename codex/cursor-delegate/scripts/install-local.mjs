// No dependencies. Uses Codex's own plugin installation commands; never rewrites config.toml.
import {
  mkdirSync,
  existsSync,
  cpSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = process.argv[2];
if (!root) {
  console.error(
    "Usage: node scripts/install-local.mjs /absolute/authorized/test-project",
  );
  process.exit(1);
}
const cwd = realpathSync(root);
if (root !== resolve(root)) throw Error("Use an absolute project path");
const source = fileURLToPath(new URL("../", import.meta.url));
const base = join(homedir(), ".local/share/cursor-delegate-local");
const destination = join(base, "plugins/cursor-delegate");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(base, "backups", stamp);
mkdirSync(backup, { recursive: true, mode: 0o700 });
for (const [label, path] of [
  [
    "config.toml",
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"),
  ],
  ["previous-plugin", destination],
]) {
  if (existsSync(path)) {
    cpSync(path, join(backup, label), { recursive: true });
    if (label === "config.toml") chmodSync(join(backup, label), 0o600);
  }
}
for (const name of [
  "scripts",
  "skills",
  ".codex-plugin",
  ".mcp.json",
  "README.md",
  "VERIFICATION.md",
])
  if (existsSync(join(source, name)))
    cpSync(join(source, name), join(destination, name), { recursive: true });
const mcp = JSON.parse(readFileSync(join(destination, ".mcp.json"), "utf8"));
mcp.mcpServers["cursor-delegate"].command = process.execPath;
const agent =
  process.env.CURSOR_AGENT_COMMAND ||
  execFileSync("which", ["agent"], { encoding: "utf8" }).trim();
mcp.mcpServers["cursor-delegate"].env = {
  CURSOR_DELEGATE_ROOT: cwd,
  CURSOR_AGENT_COMMAND: realpathSync(agent),
};
writeFileSync(
  join(destination, ".mcp.json"),
  JSON.stringify(mcp, null, 2) + "\n",
);
const manifestPath = join(destination, ".codex-plugin/plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = manifest.version.split("+")[0] + "+local." + Date.now();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const marketplacePath = join(base, ".agents/plugins/marketplace.json");
// This private installation root owns exactly one entry. Never merge into or replace personal marketplace.
if (!existsSync(marketplacePath)) {
  mkdirSync(join(base, ".agents/plugins"), { recursive: true });
  writeFileSync(
    marketplacePath,
    JSON.stringify(
      {
        name: "cursor-delegate-local",
        interface: { displayName: "Cursor Delegate Local" },
        plugins: [
          {
            name: "cursor-delegate",
            source: { source: "local", path: "./plugins/cursor-delegate" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Productivity",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}
const registered = JSON.parse(readFileSync(marketplacePath, "utf8"));
if (
  registered.name !== "cursor-delegate-local" ||
  registered.plugins?.length !== 1 ||
  registered.plugins[0].name !== "cursor-delegate" ||
  registered.plugins[0].source?.path !== "./plugins/cursor-delegate"
)
  throw Error(
    "Existing marketplace differs; refusing to replace or install another source",
  );
execFileSync("codex", ["plugin", "marketplace", "add", base], {
  stdio: "inherit",
});
execFileSync(
  "codex",
  ["plugin", "add", "cursor-delegate@cursor-delegate-local"],
  { stdio: "inherit" },
);
console.log(
  `Installed for ${cwd}. Backup: ${backup}. Open a fresh Codex App task; verify cursor_status before delegation.`,
);
