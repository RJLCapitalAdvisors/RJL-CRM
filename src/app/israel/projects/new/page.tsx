import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { createIlProject } from "../../actions";
import { IlProjectForm } from "../project-form";

export const metadata = { title: "New project" };
export const dynamic = "force-dynamic";

export default async function NewIlProjectPage() {
  const developers = await prisma.ilCompany.findMany({ where: { roles: { contains: "Sponsor" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="New project" subtitle="The whole building or development. Apartments inside it are added under Apartments and linked to it." />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <IlProjectForm developers={developers} action={createIlProject} />
        </div>
      </div>
    </>
  );
}
