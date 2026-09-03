# RJL CRM

Custom CRM for RJL Capital Advisors, replacing HubSpot.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind 4)
- Prisma 6 with SQLite locally (`prisma/dev.db`); Postgres for hosted deploys
- dnd-kit for the deals board

## Run locally

Node 24 is installed per-user at `%LOCALAPPDATA%\Programs\nodejs`.

```bash
npm install
npm run db:push      # create / migrate the local SQLite database
npm run import       # load HubSpot CSV exports (path set in .env)
npm run dev          # http://localhost:3000
```

`.env` holds `DATABASE_URL` and `HUBSPOT_EXPORT_DIR`. See `.env.example`.

## Layout

| Path | Purpose |
|---|---|
| `prisma/schema.prisma` | Data model: users, companies, contacts, investor criteria, deals, activities, templates, campaigns, criteria proposals |
| `scripts/import-hubspot.ts` | Re-runnable HubSpot CSV importer (upserts by HubSpot Record ID) |
| `src/lib/taxonomy.ts` | Controlled vocabularies (roles, asset classes, check sizes, stages, regions) and normalizers |
| `src/app/companies` | Companies table, detail, criteria editor |
| `src/app/contacts` | Contacts table, detail |
| `src/app/deals` | Deals board (drag between stages), list view, detail, new deal |

## Roadmap

1. Core CRM (done): companies, contacts, deals board, branding, HubSpot import
2. Deal mail merge with LP matching and per-recipient preview
3. Outlook Sent Items auto-logging via Microsoft Graph
4. Email blasts via a transactional provider
5. Fireflies transcript to criteria proposals with approval queue
6. Microsoft Entra sign-in and hosted deploy (Vercel + Supabase)
