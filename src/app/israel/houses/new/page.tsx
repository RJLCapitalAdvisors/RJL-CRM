import { PageHeader } from "@/components/ui";
import { usdIls } from "@/lib/fx";
import { createHouse } from "../../actions";
import { HouseForm } from "../house-form";

export const metadata = { title: "New house" };
export const dynamic = "force-dynamic";

export default async function NewHousePage() {
  const fx = await usdIls();
  return (
    <>
      <PageHeader title="New house" subtitle="Enter what you know. Developer, broker and seller are linked on the ticket afterwards." />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <HouseForm fx={fx} action={createHouse} />
        </div>
      </div>
    </>
  );
}
