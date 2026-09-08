import { PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/template-form";
import { createTemplate } from "../actions";

export const metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <>
      <PageHeader title="New template" />
      <div className="px-8 py-6">
        <TemplateForm template={null} action={createTemplate} submitLabel="Create template" />
      </div>
    </>
  );
}
