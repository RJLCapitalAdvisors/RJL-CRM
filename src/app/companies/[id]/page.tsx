import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { stageTone } from "@/lib/taxonomy";
import { PageHeader, RoleChips, Empty } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";
import { CriteriaForm } from "@/components/criteria-form";
import { fmtDate, fullName } from "@/lib/format";
import { addCompanyNote, updateCompany, updateCompanyCriteria } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [company, users] = await Promise.all([
    prisma.company.findUnique({
      where: { id },
      include: {
        owner: true,
        criteria: true,
        contacts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { owner: true } },
        deals: { orderBy: { updatedAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { contact: true, deal: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!company) notFound();

  const update = updateCompany.bind(null, company.id);
  const updateCriteria = updateCompanyCriteria.bind(null, company.id);
  const addNote = addCompanyNote.bind(null, company.id);

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={
          <span className="flex items-center gap-3">
            <RoleChips roles={company.roles} />
            <span>{[company.city, company.state].filter(Boolean).join(", ")}</span>
            {company.owner && <span>· Owner {company.owner.name}</span>}
            {company.hubspotId && <span className="text-xs">· HubSpot {company.hubspotId}</span>}
          </span>
        }
        actions={
          <Link href={`/contacts/new?companyId=${company.id}`} className="btn-secondary">
            Add contact
          </Link>
        }
      />

      <div className="grid grid-cols-3 gap-6 px-8 py-6">
        <div className="col-span-2 space-y-6">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">Investor criteria</h2>
            <CriteriaForm criteria={company.criteria} action={updateCriteria} />
          </section>

          <section className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">Contacts ({company.contacts.length})</h2>
            </div>
            {company.contacts.length === 0 ? (
              <div className="p-5">
                <Empty>No contacts linked yet.</Empty>
              </div>
            ) : (
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Roles</th>
                    <th>Owner</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {company.contacts.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <Link href={`/contacts/${k.id}`} className="font-medium hover:underline">
                          {fullName(k)}
                        </Link>
                      </td>
                      <td className="text-muted">{k.email}</td>
                      <td className="whitespace-nowrap text-muted">{k.phone}</td>
                      <td>
                        <RoleChips roles={k.roles} />
                      </td>
                      <td className="whitespace-nowrap">{k.owner?.name}</td>
                      <td className="whitespace-nowrap text-xs">
                        {k.unsubscribed ? <span className="chip bg-stone-200">Unsubscribed</span> : k.bounceReason ? <span className="chip bg-amber-100">Bounced</span> : k.marketingContact ? <span className="chip bg-sky/50">Marketing</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold">Deals as sponsor ({company.deals.length})</h2>
            </div>
            {company.deals.length === 0 ? (
              <div className="p-5">
                <Empty>No deals linked to this company.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {company.deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-5 py-3">
                    <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                    <span className={`chip border ${stageTone(d.stage)}`}>{d.stage}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">Details</h2>
            <CompanyForm company={company} users={users} action={update} />
          </section>

          <section className="card">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold">Activity</h2>
            </div>
            <form action={addNote} className="flex gap-2 border-b border-line p-4">
              <input name="body" placeholder="Add a note…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
            <ul className="divide-y divide-line">
              {company.activities.map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="font-semibold uppercase tracking-wide">{a.type}</span>
                    <span>{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                  {a.body && <div className="mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                  {(a.contact || a.deal) && (
                    <div className="mt-1 text-xs text-muted">
                      {a.contact && <span>{fullName(a.contact)} </span>}
                      {a.deal && <span>· {a.deal.name}</span>}
                    </div>
                  )}
                </li>
              ))}
              {company.activities.length === 0 && <li className="px-5 py-6 text-sm text-muted">No activity logged yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
