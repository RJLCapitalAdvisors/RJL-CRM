import { redirect } from "next/navigation";

/** Junk moved out of Settings into its own sidebar section (Oct 5, 2026); old links still land. */
export default function OldJunkPhonesPage() {
  redirect("/acquisitions/junk/phones");
}
