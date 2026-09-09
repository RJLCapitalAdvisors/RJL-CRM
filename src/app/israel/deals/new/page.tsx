import { PageHeader } from "@/components/ui";
import { createIlDeal } from "../../actions";
import { IlDealForm } from "../deal-form";
import { dealOptions } from "../options";

export const metadata = { title: "New deal" };
export const dynamic = "force-dynamic";

export default async function NewIlDealPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const opts = await dealOptions();
  return (
    <>
      <PageHeader title="New deal" subtitle="A buyer pursuing an apartment. It starts as a Lead and moves across the board from there." />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <IlDealForm d={{ apartmentId: typeof sp.apartmentId === "string" ? sp.apartmentId : null, buyerContactId: typeof sp.buyerId === "string" ? sp.buyerId : null }} {...opts} action={createIlDeal} />
        </div>
      </div>
    </>
  );
}
