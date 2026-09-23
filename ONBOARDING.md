# RJL Acquisitions CRM: working on it with Claude Code

Welcome, Shawn. This guide gets you building on the Acquisitions side of the RJL CRM with Claude Code, without touching Jonathan's two other CRMs that live in the same codebase.

## What this is

One Next.js app, one Supabase database, one Vercel deployment at https://rjl-crm.vercel.app, three walled-off CRMs:

- RJL Capital Advisors at `/` (Jonathan's)
- RJL Israel at `/israel` (Jonathan's)
- RJL Acquisitions at `/acquisitions` (yours)

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

1. **Accounts.** Jonathan invites you to the GitHub repository `RJLCapitalAdvisors/RJL-CRM` and to the Vercel team. Get your own Anthropic API key.
2. **Claude Code.** Either the desktop app (Mac or Windows) or Claude Code on the web at https://claude.ai/code connected to the repository. On the desktop app you also need Node 24 and Git, then `git clone https://github.com/RJLCapitalAdvisors/RJL-CRM.git` and `npm install`.
3. **Secrets.** Jonathan gives you `.env.local` values: `DATABASE_URL`, `DIRECT_URL` (Supabase), the Microsoft Graph app values, `ANTHROPIC_API_KEY` (yours). Never commit that file.
4. **Your scope flag.** Set `CRM_SCOPE=AQ` in your environment (Windows: `setx CRM_SCOPE AQ`; Mac: add `export CRM_SCOPE=AQ` to your shell profile). With it set, Claude Code refuses to edit outside your side, to deploy production, to push to `main`, or to run a database command that can destroy data. Jonathan does not set it.
5. **Run it.** `npm run dev`, open http://localhost:3000/acquisitions, sign in with your @rjlcapadvisors.com account.

## How a change goes out

1. Start on a fresh branch: `git checkout -b acq/<what-you-are-doing>` from `main`.
2. Tell Claude what you want, in your own words, the way you would tell a colleague ("on the property card, put County after State"; "the Buyers pipeline needs a stage called Under LOI"). Claude reads the notes, makes the change, runs `npx tsc --noEmit` and `npm run build`, and writes the decision into `docs/PROJECT-NOTES.md`.
3. Commit and push the branch, open a pull request to `main`. The Scope guard check confirms the change stayed on your side; Vercel builds a preview link for the pull request so you can click through it.
4. Merge when the preview looks right. Merging deploys production. (Until Jonathan connects Vercel to GitHub, ask him to deploy.)

Commit messages say what changed in plain words, one line, no ticket numbers.

## Things worth knowing

- **Ask the CRM** (top of your sidebar) is for data, not code: drop a spreadsheet, tell it how to read the columns, confirm the import. What you teach it is kept under Settings > Data rules.
- **Pipeline stages** are edited on the boards themselves (Edit stages). **Junk** numbers and properties are under Settings. None of that needs code.
- **The database is shared.** A new field for a property or contact is an `Aq*` model change plus `npx prisma db push`; that is fine. Never rename or drop a column that has data without talking to Jonathan.
- **Deploy previews** are per pull request; production is `main`. If something on production breaks for Jonathan's sides, he will roll back, so keep pull requests small and on your side.
- **When Claude says it cannot do something** because of scope, that is the guard working; describe the need to Jonathan.

## If you get stuck

Ask Claude to explain the relevant section of `docs/PROJECT-NOTES.md`, or message Jonathan. The notes file is the source of truth for every rule; when in doubt, read it before changing anything.
