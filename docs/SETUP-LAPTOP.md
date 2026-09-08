# Working on the RJL CRM from another computer

The live CRM (https://rjl-crm.vercel.app) and its database (Supabase) do not live on any laptop; they are
always available. This guide is for *building* the CRM with Claude Code from a second machine.

## One-time setup (about 15 minutes)

1. Install Git for Windows: https://git-scm.com/download/win (defaults are fine).
2. Install Node.js 24 LTS: https://nodejs.org (the "LTS" button, defaults are fine).
3. Install the Claude desktop app and sign in: https://claude.ai/download
4. Open PowerShell and run, one line at a time:

   ```powershell
   mkdir C:\Users\<you>\Projects
   cd C:\Users\<you>\Projects
   git clone https://github.com/RJLCapitalAdvisors/RJL-CRM.git rjl-crm
   cd rjl-crm
   npm install
   ```

5. Copy the `.env` file from the office PC (`C:\Users\Jon\Projects\rjl-crm\.env`) into the new
   `rjl-crm` folder. It holds every key (Resend, Anthropic, Azure, Supabase) and is deliberately
   **not** in Git. Keep a copy in your password manager as a secure note.
6. Run the Outlook bridge once so "Open in Outlook" works on this machine:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-outlook-link.ps1
   ```

7. In the Claude desktop app, Code tab, open the `rjl-crm` folder. Claude reads `CLAUDE.md`, which
   points at `docs/PROJECT-NOTES.md` (rules, decisions, where things live) and the CRM Build Plan in
   SharePoint, so it picks up where the last session left off.

## Every day

- Start of day: `git pull` (gets what was done on the other machine).
- End of day: commit and push. Claude commits; the push is one command you run: `git push` (Claude will hand it to you).
- Deploy to the live site: `npx vercel --prod --yes` (Claude does this after each change).

## What lives where

| Thing | Where | Backed up by |
|---|---|---|
| Live app | Vercel (rjl-crm.vercel.app) | Vercel keeps every deployment |
| Data (companies, contacts, deals, reports) | Supabase Postgres | Supabase daily backups |
| Source code | Git repo on GitHub + each laptop | GitHub |
| Secrets (`.env`) | Each laptop + your password manager | You |
| Plan and decisions | `docs/PROJECT-NOTES.md` (in Git) and `CRM Build Plan.md` (SharePoint) | GitHub / SharePoint |

## Team member: connect Outlook (no repo, 2 minutes)

For anyone who only *uses* the CRM (Aviel, Nikko, Shawn, Esther). Handle / Open in Outlook prepare the draft in your own mailbox, then hand it to desktop Outlook through a per-computer link. Do this once per computer:

1. Sign in to https://rjl-crm.vercel.app with Microsoft (bottom of the sidebar).
2. Settings -> "Outlook on this computer" -> download and run **Connect RJL CRM to Outlook.bat** (if Windows says it protected your PC: More info -> Run anyway).
3. Click "Test the Outlook link" on the same page. A confirmation box pops up when it works.

Debugging on your own: the reason a draft could not be prepared shows in red under the Handle button. If the draft was prepared but nothing opened, the link on that computer is the problem (rerun the .bat). Every attempt is logged at `%LOCALAPPDATA%\RJL CRM\last.log`; send that file to Jonathan. The draft itself is always in your Outlook Drafts folder and behind "open in Outlook web".
