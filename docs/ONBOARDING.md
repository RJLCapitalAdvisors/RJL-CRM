# Getting a new teammate onto the CRM

Generated from `src/lib/onboarding.ts` by `npm run build`; the same checklist is on the CRM's Settings page with tick boxes. Edit the TS file, not this one.

## Jonathan (admin) does

1. **Create their Microsoft 365 account on rjlcapadvisors.com** ([Microsoft 365 admin center](https://admin.microsoft.com))
   admin.microsoft.com > Users > Active users > Add a user, with an Exchange license. The CRM reads every team mailbox through the company app registration, so there is nothing to configure per person: their email starts flowing into the email log at the next sync.
2. **Add them to the deals@ shared mailbox**
   admin.microsoft.com > Teams & groups > Shared mailboxes > deals@rjlcapadvisors.com > Members. Then the deals they forward, and the CRM's replies, show up in their Outlook too.
3. **Send them the CRM address and this checklist**
   https://rjl-crm.vercel.app. Their first Microsoft sign-in creates their CRM user automatically (only @rjlcapadvisors.com addresses are accepted). No password to hand over.
4. **Explain who edits what**
   Roles (Investor / Sponsor / Lender / Broker) and investor criteria are Jonathan's to set. Anyone else's edits become proposals on Jonathan's Dashboard (Criteria updates window) to approve or dismiss. Sponsors' asset classes may fill themselves in from their website.
5. **After their first sign-in: check their signature** ([Settings](https://rjl-crm.vercel.app/settings))
   Settings shows a signature box per person. The CRM picks the signature up from a recent sent email the first time it drafts something; if the box is still empty, ask them to paste it from Outlook.
6. **If they are coming from the HubSpot era**
   Remove the HubSpot BCC address (…@bcc.hubspot.com) from their Outlook rules and signatures. The CRM logs email on its own; the BCC only adds noise.

## The new person does

1. **Sign in with Microsoft** ([Sign in](https://rjl-crm.vercel.app/login))
   Open https://rjl-crm.vercel.app and use "Sign in with Microsoft" at the bottom of the sidebar with your @rjlcapadvisors.com account. That creates your CRM user; drafts and follow-ups are made in the mailbox you sign in with.
2. **Use classic desktop Outlook on Windows**
   Handle and Open in Outlook open the reply in desktop Outlook through Outlook's automation, which the classic Windows app supports. On the new Outlook, Mac, or a browser-only setup, use the "open in Outlook web" link under each button instead.
3. **Connect the CRM to Outlook on this computer (once per computer)** ([Outlook on this computer](https://rjl-crm.vercel.app/settings#outlook))
   Settings > Outlook on this computer > download and run "Connect RJL CRM to Outlook.bat". If Windows says it protected your PC: More info, then Run anyway. No admin rights needed.
4. **Test the Outlook link** ([Test the Outlook link](https://rjl-crm.vercel.app/settings#outlook))
   Same section, click "Test the Outlook link". A confirmation box pops up. If the browser asks whether to open "RJL CRM", tick "always allow" so Handle pops the window without asking every time.
5. **Paste your email signature** ([Settings](https://rjl-crm.vercel.app/settings))
   Settings > your name. In Outlook open a new email, copy your signature, paste it into the box. Everything the CRM drafts for you carries it.
6. **Forward deals to deals@rjlcapadvisors.com** ([Deals board](https://rjl-crm.vercel.app/deals))
   Forward the sponsor's email with its attachments (or Drive / Dropbox links). A ticket appears in Deal Received within a minute and you get a reply with the deal written as it would go to investors plus the checklist gaps. A line above the forward ("introduced to X and Y", "already sent to market") is read and applied. Later emails about the same deal add to the same ticket: one deal, one ticket.
7. **Learn the Dashboard's five windows** ([Dashboard](https://rjl-crm.vercel.app/))
   LP follow-ups (investors who went quiet), Deal momentum (sponsor items, LP requests, unanswered engagement letters), Intros to reconsider, Deals ready for launch, Criteria updates (Jonathan only). Handle always replies on the existing thread with everyone on it; the item drops off once your email is sent.
8. **Know the house rules**
   Roles and investor criteria are set by Jonathan; your edits become proposals for him. Never make a second ticket for a deal that is already on the board. Progress reports come from the deal ticket (Progress report button), not from Word.

## Building the CRM (developers only)

See [SETUP-LAPTOP.md](SETUP-LAPTOP.md).
