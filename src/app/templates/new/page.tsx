import { redirect } from "next/navigation";

/** New templates start from the plus square on the templates page. */
export default function NewTemplatePage() {
  redirect("/templates");
}
