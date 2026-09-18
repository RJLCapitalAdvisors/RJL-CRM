import { PageHeader } from "@/components/ui";
import { AqPropertyForm } from "../property-form";
import { createAqProperty } from "../../actions";
import { getAqDealStages } from "@/lib/acquisitions-stages";

export const metadata = { title: "New property" };

export const dynamic = "force-dynamic";

export default async function NewAqPropertyPage() {
  const dealStages = await getAqDealStages();
  return (
    <>
      <PageHeader title="New property" />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="card p-5">
          <AqPropertyForm dealStages={dealStages} action={createAqProperty} />
        </div>
      </div>
    </>
  );
}
