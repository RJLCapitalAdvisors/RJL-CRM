# RJL Acquisitions CRM: working on it with Claude Code

Welcome, Shawn. This guide gets you building on the Acquisitions side of the RJL CRM with Claude Code, without touching Jonathan's two other CRMs that live in the same codebase.

## What this is

One Next.js app in one repository, three walled-off CRMs, two deployments (since Oct 7, 2026):

- RJL Capital Advisors (`/`) and RJL Israel (`/israel`): Jonathan's, at https://rjl-crm.vercel.app, on his database
- RJL Acquisitions (`/acquisitions`): yours, at **https://rjl-acquisitions.vercel.app**, on **your own Supabase database** and your own Claude key

Both sites build from the same `main` branch, so a change merged there reaches both; each site serves only its own side (`CRM_SIDE`).

Everything the team has decided lives in `docs/PROJECT-NOTES.md`. Claude reads it at the start of every session, and every new rule or decision goes in there as a short dated bullet, so any machine's Claude knows it next time.

## Your side of the codebase

You (and your Claude sessions) change only:

- `src/app/acquisitions/**` (the pages, forms, grids, actions)
- `src/app/api/acquisitions/**`
- `src/lib/acquisitions*.ts` and `src/lib/aq-*.ts`
- the `Aq*` models in `prisma/schema.prisma`
- appends to `docs/PROJECT-NOTES.md`

Everything else (shared components, sign-in, mail reading, the assistant's shared code, Israel, Capital Advisors) is Jonathan's. When a feature needs a change there, say so in your pull request or to Jonathan; do not make it. `scripts/scope-guard.mjs` is the exact list, and two things enforce it: a Claude Code hook on your machine and a check on every pull request.

## Set up once

1. **Accounts.** You are a collaborator on the GitHub repository `RJLCapitalAdvisors/RJL-CRM` (done). Your Supabase organization and your Anthropic organization are yours; your site is hosted in Jonathan's Vercel team (free) and he can hand it to you later.
2. **Claude Code.** Either the desktop app (Mac or Windows) or Claude Code on the web at https://claude.ai/code connected to the repository. On the desktop app you also need Node 24 and Git, then `git clone https://github.com/RJLCapitalAdvisors/RJL-CRM.git` and `npm install`.
3. **Secrets.** Make a `.env.local` in the repository folder with the same values your site runs on (Jonathan has them, or read them in Vercel under the rjl-acquisitions project > Settings > Environment Variables): `CRM_SIDE=AQ`, `DATABASE_URL` and `DIRECT_URL` (your Supabase), `ANTHROPIC_API_KEY` (yours), `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` (the RJL Acquisitions CRM app), `APP_SECRET`. Never commit that file. With these, `npm run dev` on your laptop shows your own data.
4. **Your scope flag.** Set `CRM_SCOPE=AQ` in your environment (Windows: `setx CRM_SCOPE AQ`; Mac: add `export CRM_SCOPE=AQ` to your shell profile). With it set, Claude Code refuses to edit outside your side, to deploy production, to push to `main`, or to run a database command that can destroy data. Jonathan does not set it.
5. **Run it.** `npm run dev`, open http://localhost:3000 (it lands on Acquisitions), sign in with your @rjlcapadvisors.com account.

## How a change goes out

1. Start on a fresh branch: `git checkout -b acq/<what-you-are-doing>` from `main`.
2. Tell Claude what you want, in your own words, the way you would tell a colleague ("on the property card, put County after State"; "the Buyers pipeline needs a stage called Under LOI"). Claude reads the notes, makes the change, runs `npx tsc --noEmit` and `npm run build`, and writes the decision into `docs/PROJECT-NOTES.md`.
3. Commit and push the branch, open a pull request to `main`. The Scope guard check confirms the change stayed on your side; Vercel builds a preview link for the pull request so you can click through it.
4. Merge when the preview looks right. Once the rjl-acquisitions project is connected to GitHub in Vercel, merging deploys your site on its own; until then, tell Jonathan and he deploys it (a one-line command).

Commit messages say what changed in plain words, one line, no ticket numbers.

## Things worth knowing

- **Ask the CRM** (top of your sidebar) is for data, not code: drop a spreadsheet, tell it how to read the columns, confirm the import. What you teach it is kept under Settings > Data rules.
- **Pipeline stages** are edited on the boards themselves (Edit stages). **Junk** numbers and properties have their own section in the sidebar. Your standing import instructions are under Settings > Import instructions. None of that needs code.
- **The database is yours.** A new field for a property or contact is an `Aq*` model change plus `npx prisma db push` against your `.env.local`; that is fine. Never rename or drop a column that has data without a backup; the schema file is shared with Jonathan's sides, so keep your changes to the `Aq*` models.
- **Deploy previews** are per pull request; production is `main`. If something on production breaks for Jonathan's sides, he will roll back, so keep pull requests small and on your side.
- **When Claude says it cannot do something** because of scope, that is the guard working; describe the need to Jonathan.

## If you get stuck

Ask Claude to explain the relevant section of `docs/PROJECT-NOTES.md`, or message Jonathan. The notes file is the source of truth for every rule; when in doubt, read it before changing anything.
