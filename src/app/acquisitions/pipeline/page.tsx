import { redirect } from "next/navigation";

/** /acquisitions/pipeline opens the first of the three pipelines; the sidebar lists Buyers, Operators and Deals under it. */
export default function AqPipelineIndex() {
  redirect("/acquisitions/pipeline/buyers");
}
