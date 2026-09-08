import Link from "next/link";
import { prisma } from "@/lib/db";
import { ACTIVE_STAGES, ROLES } from "@/lib/taxonomy";
import { buildAudience } from "@/lib/audience";
import { PageHeader, Empty } from "@/components/ui";
import { fullName, str } from "@/lib/format";
import { createCampaign } from "../actions";
import { AudienceTable } from "./audience-table";

export const metadata = { title: "New email blast" };

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dealId = str(sp.dealId);
  const templateId = str(sp.templateId);
  const role = str(sp.role) || "Investor";
  const minScore = Math.max(0, Number(str(sp.minScore)) || 0);
  const mode = str(sp.mode) === "BLAST" ? "BLAST" : "OUTREACH";

  const [deals, templates, deal] = await Promise.all([
    prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, propertyName: true, sponsorName: true, stage: true } }),
    prisma.emailTemplate.findMany({ orderBy: [{ kind: "asc" }, { updatedAt: "desc" }], select: { id: true, name: true, kind: true } }),
    dealId ? prisma.deal.findUnique({ where: { id: dealId } }) : null,
  ]);
  const blastNoDeal = mode === "BLAST" && !deal;
  const audience = deal ? await buildAudience(deal, role || null) : blastNoDeal ? await buildAudience({ assetClass: null, state: null, requestedAmount: null, requestType: null, strategy: null }, role || null) : [];
  const dealGaps = deal ? [!deal.assetClass && "asset class", !deal.state && "state", !deal.requestedAmount && "requested amount", !deal.requestType && "equity/debt"].filter(Boolean) : [];

  return (
    <>
      <PageHeader title="Send deal or email blast" subtitle="Pick a deal and a template, choose who receives it, then send one at a time with a personal opener or all at once as a blast" />
      <div className="space-y-6 px-8 py-6">
        <form method="get" className="card grid grid-cols-6 gap-4 p-5">
          <div>
            <label className="label" htmlFor="mode">
              How to send
            </label>
            <select id="mode" name="mode" defaultValue={mode} className="input">
              <option value="OUTREACH">One at a time (deal outreach)</option>
              <option value="BLAST">All at once (blast)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="dealId">
              Deal
            </label>
            <select id="dealId" name="dealId" defaultValue={dealId} className="input">
              <option value="">Choose a deal…</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.propertyName ?? d.name}
                  {d.sponsorName ? ` (${d.sponsorName})` : ""} · {d.stage}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="templateId">
              Template
            </label>
            <select id="templateId" name="templateId" defaultValue={templateId} className="input">
              <option value="">Choose…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "BLAST" ? "[Blast] " : ""}
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="role">
              Send to
            </label>
            <select id="role" name="role" defaultValue={role} className="input">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}s
                </option>
              ))}
              <option value="">Everyone with email</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="minScore">
              Min. match score
            </label>
            <div className="flex gap-2">
              <input id="minScore" name="minScore" type="number" min={0} max={5} defaultValue={minScore} className="input w-20" />
              <button className="btn-secondary" type="submit">
                Build list
              </button>
            </div>
          </div>
        </form>

        {!deal && !blastNoDeal && <Empty>Select a deal to build the audience, or switch &ldquo;How to send&rdquo; to a blast to email a whole group without a deal.</Empty>}

        {(deal || blastNoDeal) && (
          <>
            {deal && dealGaps.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This deal is missing {dealGaps.join(", ")}, so matching is limited.{" "}
                <Link href={`/deals/${deal!.id}`} className="underline">
                  Fill in the deal
                </Link>{" "}
                for better targeting.
              </div>
            )}
            <form action={createCampaign} className="space-y-4">
              <input type="hidden" name="dealId" value={deal?.id ?? ""} />
              <input type="hidden" name="templateId" value={templateId} />
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="minScore" value={minScore} />
              <input type="hidden" name="mode" value={mode} />
              <div className="card grid grid-cols-3 gap-4 p-5">
                <div>
                  <label className="label" htmlFor="name">
                    Name
                  </label>
                  <input id="name" name="name" className="input" defaultValue={deal ? `${deal.propertyName ?? deal.name} – ${role || "All"}s` : `Blast to ${role || "everyone"}${role ? "s" : ""} – ${new Date().toLocaleDateString("en-US")}`} />
                </div>
                <div>
                  <label className="label" htmlFor="fromName">
                    From name
                  </label>
                  <input id="fromName" name="fromName" className="input" placeholder="Jonathan Livi" />
                </div>
                <div>
                  <label className="label" htmlFor="replyTo">
                    Reply-to
                  </label>
                  <input id="replyTo" name="replyTo" type="email" className="input" placeholder="jonathan@rjlcapadvisors.com" />
                </div>
              </div>
              <AudienceTable
                rows={audience.map((a) => ({
                  id: a.id,
                  name: fullName(a),
                  email: a.email,
                  companyName: a.companyName,
                  companyId: a.companyId,
                  score: a.match.score,
                  possible: a.match.possible,
                  reasons: a.match.reasons,
                  misses: a.match.misses,
                  criteriaSource: a.criteriaSource,
                }))}
                minScore={minScore}
                templateChosen={Boolean(templateId)}
              />
            </form>
          </>
        )}
      </div>
    </>
  );
}
