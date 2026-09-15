import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IlRecipientPicker } from "./picker";
import { unitFor, type IlKind } from "./unit";

export const metadata = { title: "Send" };
export const dynamic = "force-dynamic";

/**
 * Send an apartment, a house or a project: step one, who gets it. Every contact with an email, buyers ticked
 * first; pick the people, then write the email on the next page.
 */
export default async function IlSendPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!["apartments", "houses", "projects"].includes(kind)) notFound();
  const unit = await unitFor(kind as IlKind, id);
  if (!unit) notFound();
  const contacts = await prisma.ilContact.findMany({
    where: { email: { not: null } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, roles: true, wantsCities: true, budgetMinNis: true, budgetMaxNis: true, company: { select: { name: true } } },
  });
  const noun = kind === "apartments" ? "apartment" : kind === "houses" ? "house" : "project";
  return (
    <>
      <PageHeader title={`Send ${noun}: ${unit.name}`} subtitle="Who gets it. Buyers are ticked first; search or filter by role, then go on to the email." />
      <div className="px-8 py-5">
        <IlRecipientPicker kind={kind as IlKind} id={id} contacts={contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email!, email: c.email!, roles: JSON.parse(c.roles || "[]") as string[], company: c.company?.name ?? null, wants: [c.wantsCities, c.budgetMaxNis ? `up to ₪${Math.round(c.budgetMaxNis).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ") }))} />
      </div>
    </>
  );
}
