import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { str } from "@/lib/format";
import { AqContactForm } from "../contact-form";
import { createAqContact } from "../../actions";

export const metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

export default async function NewAqContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const companies = await prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="New contact" />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="card p-5">
          <AqContactForm c={{ companyId: str(sp.companyId) || null }} companies={companies} action={createAqContact} />
        </div>
      </div>
    </>
  );
}
