"use server";

import type { InviteResult } from "@/components/invite-button";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCriteriaAdmin } from "@/lib/current-user";
import { domainAllowed, isCaMailbox, mailReadsFor, parseWorkspaces, workspacesByDomain, type Workspace } from "@/lib/access";
import { mailConfigured, sendEmail } from "@/lib/mailer";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const PAGES = ["/settings", "/settings/users", "/israel/settings", "/acquisitions/settings"];
const refresh = () => PAGES.forEach((p) => revalidatePath(p));

/** What a person opens follows from their addresses: the sign-in email's domain, plus the Israel side when an Israel-side address is on file. */
const grantsFor = (email: string | null, israelEmail: string | null): Workspace[] => [...new Set<Workspace>([...workspacesByDomain(email), ...(israelEmail ? workspacesByDomain(israelEmail) : [])])];

/** Active on or off, and (on the RJL CA page) the Israel-side address a person also uses. */
export async function updateUserAccessAction(userId: string, fd: FormData) {
  await requireCriteriaAdmin();
  const cur = await prisma.user.findUnique({ where: { id: userId } });
  if (!cur) return;
  const israelEmail = fd.has("israelEmail") ? (s(fd, "israelEmail")?.toLowerCase() ?? null) : cur.israelEmail;
  if (israelEmail && !domainAllowed(israelEmail)) throw new Error(`${israelEmail} is not an allowed address.`);
  await prisma.user.update({ where: { id: userId }, data: { israelEmail, workspaces: JSON.stringify(grantsFor(cur.email, israelEmail)), active: fd.get("active") === "on" } });
  refresh();
}

/**
 * A new person: the email's domain decides the business (an Israel-side address on the RJL CA page adds that side).
 * With "Send an invite" ticked, they get an email with the sign-in link for each business they were given.
 */
export async function addUserAction(fd: FormData) {
  const me = await requireCriteriaAdmin();
  const email = s(fd, "email")?.toLowerCase();
  const name = s(fd, "name") ?? email?.split("@")[0] ?? "";
  if (!email) return;
  if (!domainAllowed(email)) throw new Error(`${email} cannot be added: only @rjlcapadvisors.com, @rjlisrael.com and @liviemisrael.com addresses open the CRM for now.`);
  const israelEmail = s(fd, "israelEmail")?.toLowerCase() ?? (email.endsWith("@rjlisrael.com") ? email : null);
  if (israelEmail && !domainAllowed(israelEmail)) throw new Error(`${israelEmail} is not an allowed address.`);
  // added from the RJL Acquisitions page: an RJL CA address opens that side (and keeps whatever it already had)
  const side = s(fd, "side");
  const existing = await prisma.user.findUnique({ where: { email }, select: { workspaces: true, email: true } });
  const granted = [...new Set<Workspace>([...(existing ? parseWorkspaces(existing.workspaces, existing.email) : []), ...grantsFor(email, israelEmail), ...(side === "AQ" && isCaMailbox(email) ? (["AQ"] as Workspace[]) : [])])];
  const user = await prisma.user.upsert({
    where: { email },
    create: { name, email, active: true, workspaces: JSON.stringify(granted), israelEmail },
    update: { name, active: true, workspaces: JSON.stringify(granted), israelEmail },
  });
  if (fd.get("invite") === "on") await sendInvite(user.id, granted, me.name).catch((e) => console.error("invite:", String(e).slice(0, 200)));
  refresh();
}

/**
 * Email reading on or off for one side (Users > Email reading). Turning the RJL CA address on for one of RJL Capital
 * Advisors or RJL Acquisitions turns it off for the other: one mailbox feeds one log. The Israel side needs an
 * Israel address on file. The choice is stored, so later access changes do not move the mailbox by themselves.
 */
export async function setMailReadAction(userId: string, side: Workspace, on: boolean): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const me = await requireCriteriaAdmin();
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, israelEmail: true, workspaces: true, mailReads: true } });
    if (!u) return { ok: false, reason: "User not found." };
    if ((side === "CA" || side === "AQ") && !isCaMailbox(u.email)) return { ok: false, reason: "Only an @rjlcapadvisors.com mailbox can be read here." };
    if (side === "IL" && !u.israelEmail) return { ok: false, reason: u.name + " has no RJL Israel address on file." };
    let list = mailReadsFor(u).filter((x) => x !== side);
    if (on) list = [...list.filter((x) => !((side === "CA" && x === "AQ") || (side === "AQ" && x === "CA"))), side];
    await prisma.user.update({ where: { id: userId }, data: { mailReads: JSON.stringify(list) } });
    const names: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel", AQ: "RJL Acquisitions" };
    const tail = on && (side === "CA" || side === "AQ") ? " (their RJL CA mailbox now feeds " + names[side] + " only)" : "";
    await prisma.activity.create({ data: { type: "NOTE", body: me.name + " turned email reading " + (on ? "on" : "off") + " for " + u.name + " in " + names[side] + tail + "." } }).catch(() => null);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Send (or send again) the invite for one business. */
export async function sendInviteAction(userId: string, workspace: Workspace): Promise<InviteResult> {
  try {
    const me = await requireCriteriaAdmin();
    const to = await sendInvite(userId, [workspace], me.name);
    refresh();
    return { ok: true, to };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const NAMES: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel", AQ: "RJL Acquisitions" };
const DOMAIN_HINT: Record<Workspace, string> = { CA: "@rjlcapadvisors.com", IL: "@rjlisrael.com", AQ: "@rjlcapadvisors.com" };

export async function sendInvite(userId: string, workspaces: Workspace[], fromName: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.email) throw new Error("No email on file");
  if (!mailConfigured()) throw new Error("Email sending is not configured (RESEND_API_KEY and MAIL_FROM)");
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;";
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const first = user.name.split(/\s+/)[0] || "there";
  const sides = workspaces.length ? workspaces : (["CA"] as Workspace[]);
  const blocks = sides
    .map((w) => {
      const account = w === "IL" ? user.israelEmail ?? user.email : user.email;
      const link = `${base}/login?business=${w}&next=${encodeURIComponent(w === "IL" ? "/israel" : w === "AQ" ? "/acquisitions" : "/")}`;
      return `<p style="margin:0 0 6pt 0;${F}"><b>${NAMES[w]}</b></p>
<ol style="margin:0 0 12pt 18pt;${F}">
<li style="margin-bottom:4pt;">Open <a href="${link}" style="color:#1d4ed8;">${link}</a></li>
<li style="margin-bottom:4pt;">Click <b>Sign in with Microsoft</b> and use your ${esc(account ?? "")} account${account && !account.endsWith(DOMAIN_HINT[w]) ? "" : ` (the ${DOMAIN_HINT[w]} one)`}.</li>
<li>That is it. Your name is already on the list, so the door opens on the first sign-in.</li>
</ol>`;
    })
    .join("");
  const both = sides.length > 1 ? `<p style="margin:0 0 10pt 0;${F}">You have both businesses. Sign in twice, once with each account; both logos light up at the top of the sidebar once you have.</p>` : "";
  const outlook = sides.includes("CA") ? `<p style="margin:0 0 10pt 0;${F}">Once you are in, open Settings and run the small Outlook link so the CRM can hand its drafts to your Outlook. The page walks you through it.</p>` : "";
  const html = `<div style="${F}">
<p style="margin:0 0 10pt 0;${F}">Hi ${esc(first)},</p>
<p style="margin:0 0 10pt 0;${F}">${esc(fromName)} set you up on the ${sides.map((w) => NAMES[w]).join(" and ")} CRM. Here is how to get in:</p>
${blocks}${both}${outlook}
<p style="margin:0 0 10pt 0;${F}">Reply to this email if anything does not work.</p>
<p style="margin:0;${F}">${esc(fromName)}</p>
</div>`;
  // an Israel-only invite goes to the Israel-side address (Sep 17: Shawn's went to his RJL CA inbox); anything else to the sign-in email
  const to = sides.length === 1 && sides[0] === "IL" ? (user.israelEmail ?? user.email) : user.email;
  await sendEmail({ to, subject: `Your ${sides.map((w) => NAMES[w]).join(" and ")} CRM login`, html, replyTo: process.env.MAIL_REPLY_TO ?? "jonathan@rjlcapadvisors.com" });
  await prisma.user.update({ where: { id: userId }, data: { invitedAt: new Date() } });
  return to;
}

/**
 * Remove a person from the CRM, both sides (Jonathan, Sep 18). Inactive means: the session check turns them away on
 * the next request, the sign-in callback refuses them, no mailbox sync reads their mail (every reader filters
 * active), and they leave the owner, CC and Users lists. Deals, emails and notes they created stay as history.
 */
export async function removeUserAction(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const me = await requireCriteriaAdmin();
    if (me.id === userId) return { ok: false, reason: "You cannot remove yourself." };
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, israelEmail: true } });
    if (!u) return { ok: false, reason: "User not found." };
    await prisma.user.update({ where: { id: userId }, data: { active: false, invitedAt: null } });
    await prisma.activity.create({ data: { type: "NOTE", body: `${u.name} (${[u.email, u.israelEmail].filter(Boolean).join(", ")}) removed from the CRM by ${me.name}: sign-in closed, mailbox no longer read.` } }).catch(() => null);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
