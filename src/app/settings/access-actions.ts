"use server";

import type { InviteResult } from "@/components/invite-button";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCriteriaAdmin } from "@/lib/current-user";
import { domainAllowed, workspacesByDomain, type Workspace } from "@/lib/access";
import { mailConfigured, sendEmail } from "@/lib/mailer";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const PAGES = ["/settings", "/settings/users", "/israel/settings"];
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
  const granted = grantsFor(email, israelEmail);
  const user = await prisma.user.upsert({
    where: { email },
    create: { name, email, active: true, workspaces: JSON.stringify(granted), israelEmail },
    update: { name, active: true, workspaces: JSON.stringify(granted), israelEmail },
  });
  if (fd.get("invite") === "on") await sendInvite(user.id, granted, me.name).catch((e) => console.error("invite:", String(e).slice(0, 200)));
  refresh();
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

const NAMES: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel" };
const DOMAIN_HINT: Record<Workspace, string> = { CA: "@rjlcapadvisors.com", IL: "@rjlisrael.com" };

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
      const link = `${base}/login?business=${w}&next=${encodeURIComponent(w === "IL" ? "/israel" : "/")}`;
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
