import { redirect } from "next/navigation";

/** /acquisitions/junk opens Junk Properties; the sidebar lists Junk Properties and Junk Phone Numbers under it (Oct 5, 2026). */
export default function AqJunkIndex() {
  redirect("/acquisitions/junk/properties");
}
