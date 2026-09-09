import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { createIlContact } from "../../actions";
import { IlContactForm } from "../contact-form";

export const metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

export default async function NewIlContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const companies = await prisma.ilCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="New contact" />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <IlContactForm c={{ companyId: typeof sp.companyId === "string" ? sp.companyId : null, roles: typeof sp.companyId === "string" ? '["Sales agent"]' : "[]" }} companies={companies} action={createIlContact} />
        </div>
      </div>
    </>
  );
}
