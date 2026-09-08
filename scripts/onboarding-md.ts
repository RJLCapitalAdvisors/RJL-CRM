// Writes docs/ONBOARDING.md from src/lib/onboarding.ts so the checklist in Git always matches the one in the CRM.
// Runs before every build (npm run build). Edit the TS module, not the markdown.
import { writeFileSync } from "fs";
import path from "path";
import { ADMIN_STEPS, YOUR_STEPS, type Step } from "../src/lib/onboarding";

const list = (steps: Step[]) => steps.map((s, i) => `${i + 1}. **${s.title}**${s.link ? ` ([${s.link.label}](${s.link.href.startsWith("http") ? s.link.href : `https://rjl-crm.vercel.app${s.link.href}`}))` : ""}\n   ${s.detail}`).join("\n");

const md = `# Getting a new teammate onto the CRM

Generated from \`src/lib/onboarding.ts\` by \`npm run build\`; the same checklist is on the CRM's Settings page with tick boxes. Edit the TS file, not this one.

## Jonathan (admin) does

${list(ADMIN_STEPS)}

## The new person does

${list(YOUR_STEPS)}

## Building the CRM (developers only)

See [SETUP-LAPTOP.md](SETUP-LAPTOP.md).
`;

writeFileSync(path.join(__dirname, "..", "docs", "ONBOARDING.md"), md);
console.log("docs/ONBOARDING.md written");
