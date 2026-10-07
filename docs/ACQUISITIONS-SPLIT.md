# Moving RJL Acquisitions to Shawn's own accounts

Decided Oct 7, 2026. The three CRMs stay one codebase in one repository, so Jonathan's improvements keep reaching the Acquisitions side. What moves is the *running system*: Shawn's deployment runs the same code with `CRM_SIDE=AQ`, which makes it serve only `/acquisitions`, against his own database, his own Claude key and his own mailbox app, under accounts he owns and pays for.

## What each person creates

### Shawn

| Account | What for | What to hand over |
|---|---|---|
| **Vercel** (free Hobby is enough to start) | Hosts his deployment of the repo | Nothing; he imports the repo himself once he has GitHub access |
| **Supabase** (Pro recommended; the free plan's 5 GB egress cut Jonathan's off) | His database | The project's two connection strings (`DATABASE_URL` through the pooler, `DIRECT_URL` direct) |
| **Anthropic console** | Claude usage for his intake, Ask the CRM and imports | His `ANTHROPIC_API_KEY` |
| **GitHub** | A read-only collaborator on `RJLCapitalAdvisors/RJL-CRM`, so his Vercel can build from `main` | His GitHub username to Jonathan |

### Jonathan

| Item | Why |
|---|---|
| Add Shawn as a **read** collaborator on the GitHub repository | Vercel builds his project from the same `main` |
| A second **Azure app registration** in the rjlcapadvisors.com tenant, with an Exchange application access policy limited to shawn@rjlcapadvisors.com (and any later Acquisitions mailbox) | Sign-in with Microsoft on his deployment, and reading his mailbox into the Acquisitions email log, without that app being able to read anyone else's mailbox |
| Optionally a DNS name, e.g. `acq.rjlcapadvisors.com` | A link that looks like his, pointed at his Vercel project |
| The migration run (below) | Copies the Acquisitions data across once |

## Shawn's Vercel project: environment variables

| Variable | Value |
|---|---|
| `CRM_SIDE` | `AQ` |
| `DATABASE_URL`, `DIRECT_URL` | Shawn's Supabase |
| `ANTHROPIC_API_KEY` | Shawn's |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | the new app registration |
| `APP_SECRET` | any long random string (signs the sign-in cookie) |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | his deployment's address |
| `CRON_SECRET` | any long random string |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | optional, for Map View |

Not needed on his side: `DEALS_MAILBOX`, `RESEND_*`, `ISRAEL_*`, `WHATSAPP_*`, `FIREFLIES_API_KEY`, `MAIL_FROM`, `IL_MAIL_FROM`.

## Cutover, in order

1. Shawn's Supabase exists; from this repo, with his connection strings in a local `.env.acq`: `npx prisma db push` against it (creates every table, empty).
2. Jonathan runs the copy, dry first:
   ```bash
   SOURCE_DATABASE_URL=<shared DIRECT_URL> TARGET_DATABASE_URL=<Shawn's DIRECT_URL> node --import tsx scripts/migrate-acquisitions.ts --dry
   ```
   then without `--dry`. It copies the Acquisitions users, settings, every Aq table, the junk lists, the held imports and the AQ chat threads, skipping anything already there, so it can be run again right before the switch.
3. Shawn's Vercel project deploys `main` with the variables above. He signs in; his dashboard, lists, pipelines, junk and Ask the CRM are there.
4. Jonathan's deployment keeps the Acquisitions pages until Shawn confirms his is right; then `CRM_SIDE=CA,IL` on rjl-crm.vercel.app hides them there (the data stays in the shared database as a backup until Jonathan decides to drop the Aq tables).
5. Shawn's scope guard on his machine stays as it is: `CRM_SCOPE=AQ`, branches `acq/...`, pull requests to `main`. Merging still deploys both projects, each serving its own side.

## What `CRM_SIDE` does in the code

- The proxy sends every other side's path to the side's home (`/` opens `/acquisitions`).
- Sign-in only unlocks that side; the login page says so.
- The sidebar shows only that side's logo and pages.
- The daily cron reads only that side's mailboxes; the blasts cron and the deals@ notification do nothing.
