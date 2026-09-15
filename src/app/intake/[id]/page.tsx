import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ASSET_CLASSES, US_STATES } from "@/lib/taxonomy";
import { EMPTY, toChecklistDeal, type ExtractedDeal } from "@/lib/intake";
import { applicableItems, completeness, followUpText, labelFor, missingFor } from "@/lib/checklist";
import { loadChecklist } from "@/lib/required-items";
import { ChecklistFields } from "@/components/checklist-fields";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";
import { fmtDate, str } from "@/lib/format";
import { convertIntakeToDeal, dismissIntake, reprocessIntake, updateExtracted } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const i = await prisma.dealIntake.findUnique({ where: { id }, select: { subject: true } }).catch(() => null);
  return { title: i?.subject ?? "Deal intake" };
}

export const dynamic = "force-dynamic";

function Field({ id, label, value, span = 1 }: { id: string; label: string; value: unknown; span?: number }) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} name={id} defaultValue={value == null ? "" : String(value)} className={`input ${value == null ? "border-amber-300 bg-amber-50/40" : ""}`} />
    </div>
  );
}

function Select({ id, label, value, options }: { id: string; label: string; value: string; options: { v: string; l: string }[] }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={id} defaultValue={value} className={`input ${value ? "" : "border-amber-300 bg-amber-50/40"}`}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </div>
  );
}

export default async function IntakeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  await loadChecklist();
  const [it, templates] = await Promise.all([prisma.dealIntake.findUnique({ where: { id } }), prisma.emailTemplate.findMany({ orderBy: { updatedAt: "desc" } })]);
  if (!it) notFound();
  const d = { ...EMPTY, ...(JSON.parse(it.extracted) as Partial<ExtractedDeal>) } as ExtractedDeal;
  const cl = toChecklistDeal(d);
  const missing = missingFor(cl);
  const { answered, total } = completeness(cl);
  const attachments = JSON.parse(it.attachments || "[]") as string[];
  const templateId = str(sp.template) || templates[0]?.id;
  const template = templates.find((t) => t.id === templateId);
  const ctx: MergeContext = {
    contact: { firstName: "Investor", lastName: "", email: "" },
    company: { name: "your firm" },
    deal: d as unknown as Record<string, unknown>,
    sender: { name: (process.env.MAIL_FROM ?? "RJL Capital Advisors").replace(/<.*$/, "").trim() },
    unsubscribeUrl: "#",
  };
  const followUp = followUpText(cl, d.propertyName);

  return (
    <>
      <PageHeader
        title={d.propertyName ?? it.subject ?? "Forwarded deal"}
        subtitle={
          <span className="flex items-center gap-3">
            <span className={`chip ${missing.length === 0 ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
              {answered}/{total} checklist items
            </span>
            {d.strategy && <span>{d.strategy}</span>}
            {d.assetClass && <span>· {d.assetClass}</span>}
            <span>· from {it.fromName ?? it.fromEmail ?? "paste"}</span>
            <span>· {fmtDate(it.createdAt)}</span>
            <span>· parsed by {it.extractor === "claude" ? "Claude" : "pattern matcher"}</span>
            {it.status !== "PENDING" && <span>· {it.status}</span>}
          </span>
        }
        actions={
          <>
            <Link href="/intake" className="btn-secondary">
              Back
            </Link>
            {it.status === "PENDING" && (
              <>
                <form action={reprocessIntake.bind(null, it.id)}>
                  <button className="btn-secondary" type="submit">
                    Re-parse
                  </button>
                </form>
                <form action={dismissIntake.bind(null, it.id)}>
                  <button className="btn-ghost" type="submit">
                    Dismiss
                  </button>
                </form>
                <form action={convertIntakeToDeal.bind(null, it.id)}>
                  <button className="btn-primary" type="submit">
                    Create deal
                  </button>
                </form>
              </>
            )}
            {it.dealId && (
              <Link href={`/deals/${it.dealId}`} className="btn-primary">
                Open deal
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-5 gap-6 px-8 py-6">
        <section className="col-span-3 space-y-6">
          <form action={updateExtracted.bind(null, it.id)} className="space-y-6">
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Deal basics</h2>
                <span className="text-xs text-muted">Highlighted fields were not found in the email</span>
              </div>
              {it.notes && <div className="mb-4 rounded-md bg-cream-50 px-3 py-2 text-xs text-muted">{it.notes}</div>}
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field id="sponsorName" label="Sponsor" value={d.sponsorName} />
                  <Field id="propertyName" label="Property / deal name" value={d.propertyName} span={2} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <Field id="propertyAddress" label="Address" value={d.propertyAddress} span={2} />
                  <Field id="city" label="City" value={d.city} />
                  <Select id="state" label="State" value={d.state ?? ""} options={Object.keys(US_STATES).map((s) => ({ v: s, l: s }))} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <Select id="assetClass" label="Asset class" value={d.assetClass ?? ""} options={ASSET_CLASSES.map((s) => ({ v: s, l: s }))} />
                  <Select id="strategy" label="Acquisition / development" value={d.strategy ?? ""} options={[{ v: "Acquisitions", l: "Acquisitions" }, { v: "Development", l: "Development" }]} />
                  <Select id="requestType" label="Equity / debt" value={d.requestType ?? ""} options={[{ v: "Equity", l: "Equity" }, { v: "Debt", l: "Debt" }, { v: "Both", l: "Both" }]} />
                  <Select id="onMarket" label="On / off market" value={d.onMarket == null ? "" : d.onMarket ? "on" : "off"} options={[{ v: "on", l: "On market" }, { v: "off", l: "Off market" }]} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <Field id="requestedAmount" label="Requested amount ($)" value={d.requestedAmount} />
                  <Field id="purchasePrice" label="Purchase price / total cost ($)" value={d.purchasePrice} />
                  <Field id="totalEquity" label="Total equity ($)" value={d.totalEquity} />
                  <Field id="equityMultiple" label="Equity multiple" value={d.equityMultiple} />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <Field id="ltv" label="LTV / LTC %" value={d.ltv} />
                  <Field id="loanTerm" label="Loan term" value={d.loanTerm} />
                  <Field id="occupancy" label="Occupancy %" value={d.occupancy} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="sponsorExperience">
                      Sponsor bio (overall and local experience)
                    </label>
                    <textarea id="sponsorExperience" name="sponsorExperience" rows={3} defaultValue={d.sponsorExperience ?? ""} className={`input ${d.sponsorExperience ? "" : "border-amber-300 bg-amber-50/40"}`} />
                  </div>
                  <div>
                    <label className="label" htmlFor="summary">
                      Business plan / deal summary
                    </label>
                    <textarea id="summary" name="summary" rows={3} defaultValue={d.summary ?? ""} className={`input ${d.summary ? "" : "border-amber-300 bg-amber-50/40"}`} />
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">Deal ticket checklist</h2>
                <span className="text-xs text-muted">
                  {d.strategy ? `${d.strategy} list` : "Set acquisition/development above to narrow the list"}
                  {d.assetClass ? ` · ${d.assetClass}` : ""} · {applicableItems(d.strategy, d.assetClass).length} items
                </span>
              </div>
              <p className="mb-4 text-xs text-muted">Answers here flow into the deal record and into email templates via {"{{deal.facts}}"} or {"{{deal.details.<item>}}"}.</p>
              <ChecklistFields deal={cl} showCore={false} />
              <div className="mt-5 flex justify-end">
                <button className="btn-primary" type="submit">
                  Save corrections
                </button>
              </div>
            </div>
          </form>

          <details className="card">
            <summary className="cursor-pointer px-5 py-3 font-semibold">
              Original email {attachments.length > 0 && <span className="ml-2 text-xs font-normal text-muted">· attachments: {attachments.join(", ")}</span>}
            </summary>
            <pre className="whitespace-pre-wrap border-t border-line p-5 font-mono text-[12px] leading-relaxed">{it.rawText}</pre>
          </details>
        </section>

        <section className="col-span-2 space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 font-semibold">Still needed from the sponsor ({missing.length})</h2>
            {missing.length === 0 ? (
              <div className="text-sm text-emerald-800">Everything on the {d.strategy ?? ""} checklist is present.</div>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {missing.map((it) => (
                  <li key={it.key}>{labelFor(it.key, d.strategy)}</li>
                ))}
              </ol>
            )}
            {followUp && (
              <div className="mt-4 rounded-md border border-line bg-cream-50 p-3 text-xs">
                <div className="mb-1 font-semibold">Follow-up to sponsor (copy and paste)</div>
                <p className="whitespace-pre-wrap">{followUp}</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">How the template would read</h2>
              <form method="get" className="flex items-center gap-2">
                <select name="template" defaultValue={templateId} className="input w-56 text-xs">
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" type="submit">
                  Show
                </button>
              </form>
            </div>
            {template ? (
              <div className="p-5">
                <div className="mb-3 text-sm font-semibold">{renderTemplate(template.subject, ctx)}</div>
                <div className="rounded-md border border-line bg-cream-50 p-4 text-sm leading-relaxed [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: toHtml(renderTemplate(template.bodyHtml, ctx)) }} />
                <div className="mt-2 text-xs text-muted">Blank spots are fields the email did not include. Fill them on the left and save.</div>
              </div>
            ) : (
              <div className="p-5 text-sm text-muted">
                No templates yet.{" "}
                <Link href="/templates/new" className="underline">
                  Create one
                </Link>
                .
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
