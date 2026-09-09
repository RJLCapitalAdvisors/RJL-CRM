import { PageHeader } from "@/components/ui";
import { createIlCompany } from "../../actions";
import { IlCompanyForm } from "../company-form";

export const metadata = { title: "New company" };

export default function NewIlCompanyPage() {
  return (
    <>
      <PageHeader title="New company" />
      <div className="mx-auto max-w-2xl px-8 py-5">
        <div className="card p-5">
          <IlCompanyForm action={createIlCompany} />
        </div>
      </div>
    </>
  );
}
