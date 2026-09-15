"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { addAttachment, createDraft, sendDraft } from "@/lib/graph";
import { personalize } from "@/lib/israel-summary";
import { stripDashes } from "@/lib/style";
import { fileBytes, unitFor, type IlKind } from "./unit";

export type IlSendResult = { sent: number; failed: { email: string; reason: string }[] };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;";
/** Plain text to email HTML: blank lines split paragraphs, single line breaks stay. */
const toHtml = (text: string) => `<div style="${F}">${text.trim().split(/\n{2,}/).map((para) => `<p style="margin:0 0 10pt 0;">${esc(para).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;

/**
 * Launch: one email per person from the sender's RJL Israel mailbox (a draft with the files attached, then sent),
 * each with the person's first name, logged on the contact and on the ticket. Recipients are contacts, not
 * companies; there is no engagement letter on this side.
 */
export async function launchIlSend(input: { kind: IlKind; id: string; to: string[]; subject: string; text: string; files: string[] }): Promise<IlSendResult> {
  const me = await currentUser();
  const mailbox = me?.accounts.IL ?? me?.israelEmail ?? null;
  if (!me || !mailbox) return { sent: 0, failed: [{ email: "everyone", reason: "Sign in with your @rjlisrael.com account first; the emails go out from that mailbox." }] };
  const unit = await unitFor(input.kind, input.id);
  if (!unit) return { sent: 0, failed: [{ email: "everyone", reason: "The ticket was not found." }] };
  const contacts = await prisma.ilContact.findMany({ where: { id: { in: input.to }, email: { not: null } }, select: { id: true, firstName: true, lastName: true, email: true, companyId: true } });
  const files = (await Promise.all(input.files.map((k) => fileBytes(input.kind, input.id, k)))).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const subject = stripDashes(input.subject.trim());
  const text = stripDashes(input.text);
  const signature = `<p style="margin:10pt 0 0 0;${F}">${esc(me.name)}<br>RJL Israel</p>`;
  const out: IlSendResult = { sent: 0, failed: [] };
  const now = new Date();
  for (const c of contacts) {
    try {
      const html = `${toHtml(personalize(text, c.firstName))}${signature}`;
      const draft = await createDraft(mailbox, { subject, toRecipients: [c.email!], bodyHtml: `<html><body>${html}</body></html>` });
      for (const f of files) await addAttachment(mailbox, draft.id, f);
      await sendDraft(mailbox, draft.id);
      await prisma.ilActivity.create({ data: { type: "EMAIL", direction: "OUTBOUND", subject, body: `${unit.name} sent (Send ${input.kind.slice(0, -1)})${files.length ? `, ${files.length} ${files.length === 1 ? "file" : "files"}` : ""}`, occurredAt: now, contactId: c.id, companyId: c.companyId, meta: JSON.stringify({ mailbox, to: [{ address: c.email }], from: { address: mailbox }, hasAttachments: files.length > 0, send: { kind: input.kind, id: input.id } }) } });
      await prisma.ilContact.update({ where: { id: c.id }, data: { lastActivityAt: now } }).catch(() => null);
      if (c.companyId) await prisma.ilCompany.update({ where: { id: c.companyId }, data: { lastActivityAt: now } }).catch(() => null);
      out.sent++;
    } catch (e) {
      out.failed.push({ email: c.email!, reason: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  if (out.sent) {
    const names = contacts.filter((c) => !out.failed.some((f) => f.email === c.email)).map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email);
    const link = input.kind === "apartments" ? { apartmentId: input.id } : input.kind === "houses" ? { houseId: input.id } : { projectId: input.id };
    await prisma.ilNote.create({ data: { ...link, body: `Sent by ${me.name} to ${out.sent} ${out.sent === 1 ? "person" : "people"}: ${names.join(", ")}` } }).catch(() => null);
  }
  revalidatePath(`/israel/${input.kind}/${input.id}`);
  return out;
}
