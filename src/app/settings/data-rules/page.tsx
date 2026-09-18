import { DataRulesPage } from "@/components/data-rules-page";

export const metadata = { title: "Data rules" };
export const dynamic = "force-dynamic";

export default function CaDataRulesPage() {
  return <DataRulesPage workspace="CA" />;
}
