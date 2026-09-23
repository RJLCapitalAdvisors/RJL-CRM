import Link from "next/link";
import { CA_TEAM } from "@/lib/access";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { templateForDeal } from "@/lib/deal-template";
import { currentUser } from "@/lib/current-user";
import { PageHeader } from "@/components/ui";
import { dealFiles, syncSendDrafts, usualRecipients } from "@/lib/send-deal";
import { SendClient, type Firm, type SendState } from "./send-client";
import { SendToOne } from "../send-to-one";
import { after } from "next/server";
import { launchStatus, pumpLaunches } from "@/lib/launch-queue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Send ${d ? d.propertyName ?? d.name : "deal"}` };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a launch paces itself: one email at a time, a second or two apart

/** Send deal: pick who at each agreed firm gets it, personalize the first line, review, then drafts land in your Outlook to fire one by one. */
export default async function SendDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await syncSendDrafts().catch(() => 0);
  const [deal, templates] = await Promise.all([
    prisma.deal.findUnique({ where: { id }, include: { investors: { include: { contact: { include: { company: { include: { contacts: { where: { email: { not: null }, departedAt: null }, orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }] } } } } } }, orderBy: { createdAt: "asc" } } } }),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", workspace: "CA", NOT: { OR: [{ name: { contains: "Engagement" } }, { name: { startsWith: "(archived)" } }] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const name = deal.propertyName ?? deal.name;
  const fitting = deal ? await templateForDeal(deal).catch(() => null) : null;
  const house = (fitting && templates.find((t) => t.id === fitting.id)) ?? templates.find((t) => t.name.startsWith("Deal email (house")) ?? templates[0];

  const files = await dealFiles(deal.id).catch(() => []);
  const me = await currentUser();
  // a launch still going (or left behind when the tab closed): the page resumes pacing it and pumps in the background
  const launch = await launchStatus(deal.id).catch(() => null);
  if (launch && launch.queued > 0 && me) after(() => pumpLaunches(me.email, 270_000).catch(() => null));
  const team = (await prisma.user.findMany({ where: { active: true, ...CA_TEAM, email: { not: null } }, select: { name: true, email: true }, orderBy: { name: "asc" } })).filter((u) => u.email && u.email.toLowerCase() !== me?.email?.toLowerCase()).map((u) => ({ name: u.name, email: u.email! }));
  const sendState = ((): SendState | null => {
    try {
      const st = (JSON.parse(deal.details || "{}") as { sendState?: SendState }).sendState;
      return st && typeof st === "object" ? st : null;
    } catch {
      return null;
    }
  })();
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
        subtitle={`${firms.filter((f) => f.status <= 1).length} firms not yet sent · ${firms.filter((f) => f.status >= 2).length} sent earlier (turn one on with + to send it the current email again)`}
        actions={
          <>
            <SendToOne dealId={deal.id} />
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
          </>
        }
      />
      <SendClient dealId={deal.id} firms={firms} templates={templates} defaultTemplateId={house?.id ?? ""} files={files.map((f) => ({ key: f.key, name: f.name, size: f.size }))} saved={sendState} team={team} initialLaunch={launch && launch.queued > 0 ? launch : null} />
    </>
  );
}
