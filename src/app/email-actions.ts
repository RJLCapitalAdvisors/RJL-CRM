"use server";

import { currentUser } from "@/lib/current-user";
import { getMessage, graphConfigured, outlookDesktopLink } from "@/lib/graph";
import { findMessageCopy, lpOwnWords } from "@/lib/lp-message";
import { emailHtmlToText } from "@/lib/attachments";

export type EmailLinks = { ok: true; webLink: string; outlookLink: string | null; messageId: string } | { ok: false; reason: string };

/** Where this logged email lives so Outlook can open it: my copy first, else a teammate's or deals@. */
export async function openEmailAction(externalId: string, mailbox: string | null): Promise<EmailLinks> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const me = await currentUser();
  const copy = await findMessageCopy(externalId, mailbox ?? me?.email ?? "").catch(() => null);
  if (!copy) return { ok: false, reason: "That email is not in any team mailbox anymore." };
  const m = await getMessage(copy.box, copy.id, "id,webLink").catch(() => null);
  return { ok: true, webLink: m?.webLink ?? "", outlookLink: await outlookDesktopLink(copy.box, copy.id), messageId: externalId };
}

/** The whole email as text: what was written on top, then the quoted history below a marker. */
export async function emailBodyAction(externalId: string, mailbox: string | null): Promise<{ own: string; rest: string } | null> {
  if (!graphConfigured()) return null;
  const me = await currentUser();
  const copy = await findMessageCopy(externalId, mailbox ?? me?.email ?? "").catch(() => null);
  if (!copy) return null;
  const own = lpOwnWords(copy.body);
  const full = emailHtmlToText(copy.body).trim();
  const rest = full.startsWith(own) ? full.slice(own.length).trim() : full.length > own.length + 40 ? full : "";
  return { own, rest: rest.slice(0, 12_000) };
}
