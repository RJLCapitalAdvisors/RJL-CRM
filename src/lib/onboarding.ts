/**
 * The living checklist for getting a new teammate onto the CRM. One source: the Settings page renders it,
 * `npm run build` writes docs/ONBOARDING.md from it. Whenever a feature adds a per-person setup step
 * (a connector, a permission, a habit), add it here and it reaches both places.
 */

export type Step = { title: string; detail: string; link?: { href: string; label: string } };

/** What Jonathan (or whoever administers Microsoft 365) does before and right after someone starts. */
export const ADMIN_STEPS: Step[] = [
  {
    title: "Create their Microsoft 365 account on rjlcapadvisors.com",
    detail: "admin.microsoft.com > Users > Active users > Add a user, with an Exchange license. The CRM reads every team mailbox through the company app registration, so there is nothing to configure per person: their email starts flowing into the email log at the next sync.",
    link: { href: "https://admin.microsoft.com", label: "Microsoft 365 admin center" },
  },
  {
    title: "Add them to the deals@ shared mailbox",
    detail: "admin.microsoft.com > Teams & groups > Shared mailboxes > deals@rjlcapadvisors.com > Members. Then the deals they forward, and the CRM's replies, show up in their Outlook too.",
  },
  {
    title: "Send them the CRM address and this checklist",
    detail: "https://rjl-crm.vercel.app. Their first Microsoft sign-in creates their CRM user automatically (only @rjlcapadvisors.com addresses are accepted). No password to hand over.",
  },
  {
    title: "Explain who edits what",
    detail: "Roles (Investor / Sponsor / Lender / Broker) and investor criteria are Jonathan's to set. Anyone else's edits become proposals on Jonathan's Dashboard (Criteria updates window) to approve or dismiss. Sponsors' asset classes may fill themselves in from their website.",
  },
  {
    title: "After their first sign-in: check their signature",
    detail: "Settings shows a signature box per person. The CRM picks the signature up from a recent sent email the first time it drafts something; if the box is still empty, ask them to paste it from Outlook.",
    link: { href: "/settings", label: "Settings" },
  },
  {
    title: "If they are coming from the HubSpot era",
    detail: "Remove the HubSpot BCC address (…@bcc.hubspot.com) from their Outlook rules and signatures. The CRM logs email on its own; the BCC only adds noise.",
  },
];

/** What the new person does, in order. */
export const YOUR_STEPS: Step[] = [
  {
    title: "Sign in with Microsoft",
    detail: "Open https://rjl-crm.vercel.app and use \"Sign in with Microsoft\" at the bottom of the sidebar with your @rjlcapadvisors.com account. That creates your CRM user; drafts and follow-ups are made in the mailbox you sign in with.",
    link: { href: "/login", label: "Sign in" },
  },
  {
    title: "Use classic desktop Outlook on Windows",
    detail: "Handle and Open in Outlook open the reply in desktop Outlook through Outlook's automation, which the classic Windows app supports. On the new Outlook, Mac, or a browser-only setup, use the \"open in Outlook web\" link under each button instead.",
  },
  {
    title: "Connect the CRM to Outlook on this computer (once per computer)",
    detail: "Settings > Outlook on this computer > download and run \"Connect RJL CRM to Outlook.bat\". If Windows says it protected your PC: More info, then Run anyway. No admin rights needed.",
    link: { href: "/settings#outlook", label: "Outlook on this computer" },
  },
  {
    title: "Test the Outlook link",
    detail: "Same section, click \"Test the Outlook link\". A confirmation box pops up. If the browser asks whether to open \"RJL CRM\", tick \"always allow\" so Handle pops the window without asking every time.",
    link: { href: "/settings#outlook", label: "Test the Outlook link" },
  },
  {
    title: "Paste your email signature",
    detail: "Settings > your name. In Outlook open a new email, copy your signature, paste it into the box. Everything the CRM drafts for you carries it.",
    link: { href: "/settings", label: "Settings" },
  },
  {
    title: "Forward deals to deals@rjlcapadvisors.com",
    detail: "Forward the sponsor's email with its attachments (or Drive / Dropbox links). A ticket appears in Deal Received within a minute and you get a reply with the deal written as it would go to investors plus the checklist gaps. A line above the forward (\"introduced to X and Y\", \"already sent to market\") is read and applied. Later emails about the same deal add to the same ticket: one deal, one ticket.",
    link: { href: "/deals", label: "Deals board" },
  },
  {
    title: "Learn the Dashboard's five windows",
    detail: "LP follow-ups (investors who went quiet), Deal momentum (sponsor items, LP requests, unanswered engagement letters), Intros to reconsider, Deals ready for launch, Criteria updates (Jonathan only). Handle always replies on the existing thread with everyone on it; the item drops off once your email is sent.",
    link: { href: "/", label: "Dashboard" },
  },
  {
    title: "Know the house rules",
    detail: "Roles and investor criteria are set by Jonathan; your edits become proposals for him. Never make a second ticket for a deal that is already on the board. Progress reports come from the deal ticket (Progress report button), not from Word.",
  },
];
