import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { usdIls } from "@/lib/fx";
import { createHouse } from "../../actions";
import { HouseForm } from "../house-form";

export const metadata = { title: "New house" };
export const dynamic = "force-dynamic";

export default async function NewHousePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [fx, projects] = await Promise.all([usdIls(), prisma.ilProject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } })]);
  return (
    <>
      <PageHeader title="New house" subtitle="Enter what you know. Developer, broker and seller are linked on the ticket afterwards." />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <HouseForm h={{ projectId: typeof sp.projectId === "string" ? sp.projectId : null }} fx={fx} projects={projects} action={createHouse} />
        </div>
      </div>
    </>
  );
}
