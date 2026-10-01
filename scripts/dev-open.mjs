// Local dev server with the sign-in gate open (no password, no Azure app): for reproducing page errors from Claude Code.
import { spawn } from "node:child_process";
const env = { ...process.env, APP_PASSWORD: "", AZURE_CLIENT_ID: "", PORT: "3123" };
const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "-p", "3123"], { env, stdio: "inherit", shell: process.platform === "win32" });
p.on("exit", (c) => process.exit(c ?? 0));
