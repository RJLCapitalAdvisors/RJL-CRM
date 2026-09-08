const fs = require("fs");
// followup.ts: reply to the latest thread we have with a person (any subject), else start a fresh note to them
let f = fs.readFileSync("src/lib/followup.ts", "utf8");
f += `
/**
 * Fallback when the thread we recorded is not in this mailbox (it was in a teammate's or in deals@):
 * reply-all to the latest email in MY mailbox with that person (preferring one that mentions the deal),
 * else start a fresh email to them with the deal in the subject. Body is blank with my signature.
 */
export async function replyToLatestWith(mailbox: string, email: string, subjectHint: string, dealWords: string[] = []): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const sent = await sentMessagesTo(mailbox, email, 15).catch(() => [] as GraphMessage[]);
  const about = (m: GraphMessage) => dealWords.some((w) => (m.subject ?? "").toLowerCase().includes(w));
  const original = sent.find(about) ?? sent[0];
  const sig = await signatureFor(mailbox);
  const blank = \`<div style="\${FONT}"><p style="margin:0 0 12pt 0;\${FONT}"><br></p>\${sig}<br></div>\`;
  let draft: GraphMessage;
  let mode: "replyAll" | "new" = "new";
  if (original) {
    draft = await createReplyAllDraft(mailbox, original.id);
    await updateDraftBody(mailbox, draft.id, insertAtTop(draft.body?.content ?? "", blank));
    mode = "replyAll";
  } else {
    draft = await createDraft(mailbox, { subject: subjectHint, toRecipients: [email], bodyHtml: \`<html><body>\${blank}</body></html>\` });
  }
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode, attachments: 0 };
}
`;
fs.writeFileSync("src/lib/followup.ts", f);

// todo-actions: momentum Handle falls back to the party's contact
let a = fs.readFileSync("src/app/todo-actions.ts", "utf8");
a = a.replace(`  const { createThreadReplyDraft, createFollowUpDraft } = await import("@/lib/followup");
  try {
    if (m.lastMessageId) return await createThreadReplyDraft(me.email, m.lastMessageId);
    // no thread on record (e.g. an action item): fall back to the deal's tracker row for that contact, else fail politely
    if (m.contactId) {
      const row = await prisma.dealInvestor.findFirst({ where: { dealId: m.dealId, contactId: m.contactId } });
      if (row) return await createFollowUpDraft(row.id, me.email);
    }
    return { ok: false as const, reason: "No email thread on record for this yet. Write to them from Outlook." };`, `  const { createThreadReplyDraft, createFollowUpDraft, replyToLatestWith } = await import("@/lib/followup");
  try {
    // 1) the exact thread we recorded, if it is in my mailbox
    if (m.lastMessageId) {
      const r = await createThreadReplyDraft(me.email, m.lastMessageId);
      if (r.ok) return r;
    }
    // 2) an LP on the deal's report: the normal deal follow-up
    if (m.contactId) {
      const row = await prisma.dealInvestor.findFirst({ where: { dealId: m.dealId, contactId: m.contactId } });
      if (row) return await createFollowUpDraft(row.id, me.email);
    }
    // 3) the person we are waiting on (sponsor contact, else the company's usual person): latest thread with them in MY mailbox, else a fresh email
    const deal = await prisma.deal.findUnique({ where: { id: m.dealId }, select: { propertyName: true, name: true, sponsorCompanyId: true } });
    let contact = m.contactId ? await prisma.contact.findUnique({ where: { id: m.contactId } }) : null;
    if (!contact?.email) {
      const { bestContactForCompany } = await import("@/lib/engagement");
      const cid = m.companyId ?? deal?.sponsorCompanyId ?? null;
      contact = cid ? await bestContactForCompany(cid) : null;
    }
    if (!contact?.email) return { ok: false as const, reason: \`No email address on file for \${m.party}. Add one on their contact page.\` };
    const dealName = deal?.propertyName ?? deal?.name ?? "";
    const words = dealName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return await replyToLatestWith(me.email, contact.email, \`RE: \${dealName}\`, words);`);
fs.writeFileSync("src/app/todo-actions.ts", a);

// bridge: try the MAPI entry id first, kick a sync, then Message-ID, then Drafts
let ps = fs.readFileSync("scripts/outlook-open.ps1", "utf8");
ps = ps.replace(`Add-Type -AssemblyName System.Web
$mid = $null
if ($Url -match 'mid=([^&]+)') { $mid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }`, `Add-Type -AssemblyName System.Web
$mid = $null; $eid = $null
if ($Url -match 'mid=([^&]+)') { $mid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
if ($Url -match 'eid=([0-9A-Fa-f]+)') { $eid = $Matches[1] }`);
ps = ps.replace(`$drafts = $ns.GetDefaultFolder(16)   # olFolderDrafts
`, `$drafts = $ns.GetDefaultFolder(16)   # olFolderDrafts

# fastest path: open by MAPI entry id (works as soon as the item has synced down)
if ($eid) {
  for ($try = 0; $try -lt 12; $try++) {
    try { $item = $ns.GetItemFromID($eid); if ($item) { $item.Display(); exit 0 } } catch { }
    if ($try -eq 0) { try { $ns.SendAndReceive($false) | Out-Null } catch { } }
    Start-Sleep -Seconds 1
  }
}
`);
fs.writeFileSync("scripts/outlook-open.ps1", ps);

// client: include the entry id in the bridge link
let d = fs.readFileSync("src/app/draft-button.tsx", "utf8");
d = d.replace(/const desktopHref = \(r: [^)]*\) => [^\n]*\n/, (line) => line.replace("`rjlcrm:open?mid=${encodeURIComponent(r.messageId)}`", "`rjlcrm:open?mid=${encodeURIComponent(r.messageId)}${r.outlookLink ? `&eid=${r.outlookLink.replace(/^outlook:/, \"\")}` : \"\"}`"));
fs.writeFileSync("src/app/draft-button.tsx", d);
let rn = fs.readFileSync("src/app/respond-now.tsx", "utf8");
rn = rn.replace("`rjlcrm:open?mid=${encodeURIComponent(r.messageId)}`", "`rjlcrm:open?mid=${encodeURIComponent(r.messageId)}${r.outlookLink ? `&eid=${r.outlookLink.replace(/^outlook:/, \"\")}` : \"\"}`");
fs.writeFileSync("src/app/respond-now.tsx", rn);
console.log("ok", a.includes("replyToLatestWith(me.email"), ps.includes("GetItemFromID"), d.includes("&eid="), rn.includes("&eid="));
