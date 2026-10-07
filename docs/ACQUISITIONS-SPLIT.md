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

## Jonathan's steps, in detail

### 1. GitHub: let Shawn's Vercel read the repository (5 minutes)

1. Open https://github.com/RJLCapitalAdvisors/RJL-CRM/settings/access (Settings > Collaborators and teams on the repository).
2. Add people > type Shawn's GitHub username > choose the **Read** role > Add. He gets an email to accept.
3. Read is enough: Vercel only needs to pull `main` to build. He cannot push to `main` (the scope guard and his branch habit cover his own changes, which still come in as pull requests to you).

### 2. Azure: an app registration that signs Shawn in and reads only his mailbox (20 minutes)

The existing app (the one in rjl-crm.vercel.app's variables) can read every mailbox in the tenant. Shawn's deployment gets its own app, limited to his mailbox by an Exchange policy.

**Register the app**

1. Go to https://entra.microsoft.com, sign in as the rjlcapadvisors.com admin.
2. Identity > Applications > App registrations > **New registration**.
   - Name: `RJL Acquisitions CRM`.
   - Supported account types: *Accounts in this organizational directory only*.
   - Redirect URI: platform **Web**, value `https://<Shawn's deployment address>/api/auth/callback` (for example `https://acq.rjlcapadvisors.com/api/auth/callback`; a Vercel address like `https://rjl-acquisitions.vercel.app/api/auth/callback` works too, and you can add the custom domain later under Authentication).
   - Register.
3. On the Overview page copy **Application (client) ID** and **Directory (tenant) ID**. These are his `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.
4. Certificates & secrets > **New client secret** > description `vercel`, expiry 24 months > Add. Copy the **Value** now (it is shown once). This is his `AZURE_CLIENT_SECRET`.
5. API permissions > Add a permission > Microsoft Graph:
   - **Delegated**: `openid`, `profile`, `email`, `User.Read` (sign-in).
   - **Application**: `Mail.Read` (reading his mailbox into the Acquisitions email log).
   - Then **Grant admin consent for RJL Capital Advisors** (the button above the list) so nobody is prompted.

**Limit it to Shawn's mailbox (Exchange application access policy)**

Without this, `Mail.Read` as an application permission can read every mailbox in the tenant. The policy restricts the app to a group.

6. In the Microsoft 365 admin center (https://admin.microsoft.com) > Teams & groups > Active teams & groups > **Add a mail-enabled security group** named `Acquisitions CRM mailboxes`, with Shawn as its only member. Note its email address (for example `acq-crm@rjlcapadvisors.com`).
7. Open PowerShell as administrator on your machine and run, line by line (answer the sign-in prompt with the admin account):
   ```powershell
   Install-Module ExchangeOnlineManagement -Scope CurrentUser
   Connect-ExchangeOnline
   New-ApplicationAccessPolicy -AppId <Application (client) ID from step 3> -PolicyScopeGroupId acq-crm@rjlcapadvisors.com -AccessRight RestrictAccess -Description "RJL Acquisitions CRM reads only the mailboxes in this group"
   Test-ApplicationAccessPolicy -AppId <the same id> -Identity shawn@rjlcapadvisors.com
   Test-ApplicationAccessPolicy -AppId <the same id> -Identity jonathan@rjlcapadvisors.com
   ```
   The first test should say `AccessCheckResult : Granted`, the second `Denied`. The policy takes up to 30 minutes to apply everywhere.
8. Send Shawn the three values from steps 3 and 4 by a private channel (not email in the clear): client id, tenant id, client secret.

### 3. DNS: a name of his own (optional, 10 minutes)

1. In Shawn's Vercel project > Settings > Domains he adds `acq.rjlcapadvisors.com`; Vercel shows the record it wants (a CNAME to `cname.vercel-dns.com`).
2. Wherever rjlcapadvisors.com's DNS lives (the registrar or Cloudflare), add that CNAME: name `acq`, target `cname.vercel-dns.com`.
3. Once Vercel shows the domain as valid, add `https://acq.rjlcapadvisors.com/api/auth/callback` as a second redirect URI on the app registration (Authentication page), and his `APP_URL` / `NEXT_PUBLIC_APP_URL` become that address.

### 4. The data copy (done with Claude, 15 minutes)

1. Shawn sends you his Supabase project's two connection strings (Project settings > Database > Connection string: the *transaction pooler* one is `DATABASE_URL`, the *direct* one is `DIRECT_URL`).
2. In this repository, Claude pushes the schema to his database (`npx prisma db push` with his strings in a local `.env.acq`), runs `scripts/migrate-acquisitions.ts --dry`, shows you the counts, then runs it for real.
3. Shawn fills his Vercel variables (the table above), deploys, signs in with his Microsoft account, and checks his dashboard, properties, pipelines, junk lists and Ask the CRM against what he sees on rjl-crm.vercel.app today.
4. When he says it matches, Claude sets `CRM_SIDE=CA,IL` on your Vercel project and redeploys; the Acquisitions pages vanish from your deployment and its data stays in your database as a backup.
