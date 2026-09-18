import { PageHeader } from "@/components/ui";
import { AqPropertyForm } from "../property-form";
import { createAqProperty } from "../../actions";

export const metadata = { title: "New property" };

export default function NewAqPropertyPage() {
  return (
    <>
      <PageHeader title="New property" />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="card p-5">
          <AqPropertyForm action={createAqProperty} />
        </div>
      </div>
    </>
  );
}
