#!/usr/bin/env node
/**
 * Claude Code hook (PreToolUse) that keeps an Acquisitions session inside the Acquisitions side (Jonathan, Sep 23, 2026).
 * It only bites when the environment says CRM_SCOPE=AQ (Shawn's machine sets it; see ONBOARDING.md). Then:
 *   - Edit / Write / MultiEdit / NotebookEdit on a file outside scripts/scope-guard.mjs's AQ_SCOPE is refused;
 *   - Bash commands that deploy production, push to main, or reset the database are refused.
 * Exit code 2 blocks the tool call and shows the reason to Claude, who tells the person.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { inAqScope } from "./scope-guard.mjs";

if (process.env.CRM_SCOPE !== "AQ") process.exit(0);

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // fail closed: an Acquisitions session never gets a tool call the guard could not read
  console.error("Acquisitions scope: the guard could not read this tool call; try again.");
  process.exit(2);
}
const tool = input.tool_name ?? "";
const args = input.tool_input ?? {};
const refuse = (why) => {
  console.error(`Acquisitions scope: ${why} This session may change only the RJL Acquisitions side (src/app/acquisitions, src/lib/acquisitions*, src/lib/aq-*, the Aq* models, docs/PROJECT-NOTES.md). Anything else is Jonathan's: describe what is needed and he will make it.`);
  process.exit(2);
};

if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
  const p = String(args.file_path ?? args.notebook_path ?? "");
  const rel = p.replace(/\\/g, "/").replace(/^.*?\/rjl-crm\//i, "");
  if (rel && !inAqScope(rel)) refuse(`${rel} is outside it.`);
}

if (tool === "Bash" || tool === "PowerShell") {
  const cmd = String(args.command ?? "");
  if (/vercel\b[^\n]*--prod/.test(cmd)) refuse("production deploys are Jonathan's; merging your pull request deploys.");
  if (/prisma\s+(migrate\s+reset|db\s+push[^\n]*--(force-reset|accept-data-loss))/.test(cmd)) refuse("that database command can destroy data.");
  if (/git\s+push\b[^\n]*\b(main|master)\b/.test(cmd)) refuse("pushes go to your own branch, then a pull request.");
  if (/git\s+push\b/.test(cmd) && !/git\s+push\b[^\n]*\s\S+\s+\S+/.test(cmd)) {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
      if (branch === "main" || branch === "master") refuse("you are on main; work on a branch (acq/<what>) and open a pull request.");
    } catch {
      /* not a git checkout: nothing to check */
    }
  }
}
process.exit(0);
