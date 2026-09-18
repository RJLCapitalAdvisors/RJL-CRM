import { PageHeader } from "@/components/ui";
import { AqCompanyForm } from "../company-form";
import { createAqCompany } from "../../actions";

export const metadata = { title: "New company" };

export default function NewAqCompanyPage() {
  return (
    <>
      <PageHeader title="New company" />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="card p-5">
          <AqCompanyForm action={createAqCompany} />
        </div>
      </div>
    </>
  );
}
