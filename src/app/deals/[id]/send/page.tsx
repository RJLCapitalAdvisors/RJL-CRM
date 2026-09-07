import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { dealFiles, syncSendDrafts, usualRecipients } from "@/lib/send-deal";
import { SendClient, type Firm } from "./send-client";

export const dynamic = "force-dynamic";

/** Send deal: pick who at each agreed firm gets it, personalize the first line, review, then drafts land in your Outlook to fire one by one. */
export default async function SendDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await syncSendDrafts().catch(() => 0);
  const [deal, templates] = await Promise.all([
    prisma.deal.findUnique({ where: { id }, include: { investors: { include: { contact: { include: { company: { include: { contacts: { where: { email: { not: null } }, orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }] } } } } } }, orderBy: { createdAt: "asc" } } } }),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", NOT: { name: { contains: "Engagement" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const name = deal.propertyName ?? deal.name;
  const house = templates.find((t) => t.name.startsWith("Deal email (house")) ?? templates[0];

  const files = await dealFiles(deal.id).catch(() => []);
  const defaults = new Map<string, string[]>();
  for (const r of deal.investors) {
    if (r.contact.companyId && !defaults.has(r.contact.companyId)) defaults.set(r.contact.companyId, await usualRecipients(r.contact.companyId, r.contact.company?.contacts ?? []));
  }
  const firms: Firm[] = deal.investors.map((r) => ({
    rowId: r.id,
    status: r.status,
    company: r.contact.company?.name ?? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
    domain: r.contact.company?.domain ?? null,
    people: (r.contact.company?.contacts ?? [{ id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, email: r.contact.email, title: null }]).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "", email: c.email ?? "", title: c.title ?? null })),
    primaryContactId: r.contactId,
    extraContactIds: r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : [],
    // who we usually write to at this firm (from the email log); falls back to the report's contact
    defaultContactIds: (r.contact.companyId && defaults.get(r.contact.companyId)?.length ? defaults.get(r.contact.companyId)! : [r.contactId]),
    openingLine: r.openingLine,
    bodyOverride: r.bodyOverride,
    draftOpen: Boolean(r.sendDraftId),
  }));

  return (
    <>
      <PageHeader
        title={`Send ${name}`}
        subtitle={`${firms.filter((f) => f.status <= 1).length} firms to send · ${firms.filter((f) => f.status >= 2).length} already sent`}
        actions={
          <Link href={`/deals/${deal.id}`} className="btn-secondary">
            Back to deal
          </Link>
        }
      />
      <SendClient dealId={deal.id} firms={firms} templates={templates} defaultTemplateId={house?.id ?? ""} files={files.map((f) => ({ key: f.key, name: f.name, size: f.size }))} />
    </>
  );
}
