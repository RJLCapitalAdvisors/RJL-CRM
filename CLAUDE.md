@AGENTS.md

# Project notes for Claude

Read `docs/PROJECT-NOTES.md` first: Jonathan's rules (UX, roles, criteria approvals, email style), what lives where (Vercel, Supabase, Graph, Resend), and decisions to date. The running log of work and open items is `CRM Build Plan.md` in SharePoint (03 Plan and Docs). Keep `docs/PROJECT-NOTES.md` updated when a new rule or decision is made so any machine's Claude session has it.

# Three CRMs, one codebase: stay on your side

RJL Capital Advisors (paths `/`), RJL Israel (`/israel`) and RJL Acquisitions (`/acquisitions`) share this repository, one database and one deployment. Jonathan owns Capital Advisors and Israel and the shared code; Shawn owns Acquisitions.

- An **Acquisitions session** (Shawn, or anyone working for him) changes only: `src/app/acquisitions/**`, `src/app/api/acquisitions/**`, `src/lib/acquisitions*.ts`, `src/lib/aq-*.ts`, the `Aq*` models in `prisma/schema.prisma`, and appends to `docs/PROJECT-NOTES.md`. Shared components (`src/components`), auth, mail, the assistant's shared code, Israel and Capital Advisors are Jonathan's: describe what is needed in the pull request or to Jonathan instead of changing them. `scripts/scope-guard.mjs` is the definition; the pull request check and the Claude Code hook enforce it.
- Acquisitions work happens on a branch named `acq/<what>`, with a pull request to `main`. Merging deploys. Never run `vercel --prod`, never push to `main`, never run a database command that can destroy data (`migrate reset`, `db push --accept-data-loss`, `--force-reset`). Plain `prisma db push` for a new Aq field is fine.
- Data rules and pipeline stages for Acquisitions are data (Settings > Data rules, the pipeline boards); teach the CRM there rather than hard-coding.
- Jonathan's sessions have the whole codebase. Jonathan does not need to set `CRM_SCOPE`.
