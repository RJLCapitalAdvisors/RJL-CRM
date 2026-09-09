import { PageHeader } from "@/components/ui";
import { usdIls } from "@/lib/fx";
import { createApartment } from "../../actions";
import { ApartmentForm } from "../apartment-form";

export const metadata = { title: "New apartment" };
export const dynamic = "force-dynamic";

export default async function NewApartmentPage() {
  const fx = await usdIls();
  return (
    <>
      <PageHeader title="New apartment" subtitle="Enter what you know. Developer, agent and seller are linked on the ticket afterwards." />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <ApartmentForm fx={fx} action={createApartment} />
        </div>
      </div>
    </>
  );
}
