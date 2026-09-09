import { PageHeader } from "@/components/ui";
import { createIlCompany } from "../../actions";
import { IlCompanyForm } from "../company-form";

export const metadata = { title: "New company" };

export default function NewIlCompanyPage() {
  return (
    <>
      <PageHeader compact title="New company" />
      <div className="mx-auto max-w-2xl px-6 py-5">
        <div className="card p-5">
          <IlCompanyForm action={createIlCompany} submitLabel="Create company" />
        </div>
      </div>
    </>
  );
}
