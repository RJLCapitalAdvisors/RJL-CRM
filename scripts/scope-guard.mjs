#!/usr/bin/env node
/**
 * The wall between the three CRMs in one codebase (Jonathan, Sep 23, 2026): a change made for RJL Acquisitions may touch
 * only the Acquisitions side. This script is the one place that knows what "the Acquisitions side" is; the GitHub check
 * (.github/workflows/scope-guard.yml) and the Claude Code hook (scripts/claude-scope-guard.mjs) both use it.
 *
 *   node scripts/scope-guard.mjs --base <git ref>     check the files changed since <ref> (used by the pull request check)
 *   node scripts/scope-guard.mjs <file> [<file> ...]  check the given paths
 *
 * Exit 0 when everything is in scope, 1 with a list of what is not.
 */
import { execSync } from "node:child_process";

/** What an Acquisitions session may change. Everything else (Israel, Capital Advisors, shared components, auth, mail) needs Jonathan. */
export const AQ_SCOPE = [
  /^src\/app\/acquisitions\//,
  /^src\/app\/api\/acquisitions\//,
  /^src\/lib\/acquisitions[^/]*\.ts$/,
  /^src\/lib\/aq-[^/]*\.ts$/,
  /^scripts\/_[^/]*$/, // scratch scripts, never committed
  /^docs\/PROJECT-NOTES\.md$/, // the shared notes: append, do not rewrite others' entries
  /^prisma\/schema\.prisma$/, // only the Aq* models may change (checked below)
];

export const inAqScope = (path) => AQ_SCOPE.some((re) => re.test(path.replace(/\\/g, "/")));

/** The schema with every `model Aq...` block cut out: what is left must be identical before and after. */
export const schemaWithoutAq = (text) => text.replace(/^model Aq\w+ \{[\s\S]*?^\}\s*$/gm, "").replace(/^\/\*\*[^\n]*\n(?=\s*$)/gm, "").replace(/\s+/g, " ").trim();

export function checkFiles(files) {
  return files.filter((f) => f && !inAqScope(f));
}

export function checkSchema(base) {
  let before = "";
  try {
    before = execSync(`git show ${base}:prisma/schema.prisma`, { encoding: "utf8" });
  } catch {
    return null; // no schema at the base: nothing to compare
  }
  let after = "";
  try {
    after = execSync("git show HEAD:prisma/schema.prisma", { encoding: "utf8" });
  } catch {
    after = "";
  }
  if (schemaWithoutAq(before) !== schemaWithoutAq(after)) return "prisma/schema.prisma changes a model that is not an Acquisitions (Aq*) model";
  return null;
}

const argv = process.argv.slice(2);
if (/(^|[\\/])scope-guard\.mjs$/.test(process.argv[1] ?? "")) {
  const problems = [];
  if (argv[0] === "--base") {
    const base = argv[1];
    const files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    problems.push(...checkFiles(files).map((f) => `outside the Acquisitions side: ${f}`));
    if (files.includes("prisma/schema.prisma")) {
      const s = checkSchema(base);
      if (s) problems.push(s);
    }
  } else {
    problems.push(...checkFiles(argv).map((f) => `outside the Acquisitions side: ${f}`));
  }
  if (problems.length) {
    console.error("Scope guard: this change reaches past RJL Acquisitions. Ask Jonathan to make or review these:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("Scope guard: everything is on the Acquisitions side.");
}
