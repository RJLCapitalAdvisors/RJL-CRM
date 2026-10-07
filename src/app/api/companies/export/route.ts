import { currentUser } from "@/lib/current-user";
import { companyFiltersFrom } from "@/lib/company-filters";
import { buildCompanyExport, picksFrom } from "@/lib/company-export";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** The Companies list as an Excel file: the list's own filters (?q=&role=&asset=&state=) plus the picked columns (?cols=&emp=&layout=). Signed-in people only. */
export async function GET(req: Request) {
  const gated = Boolean(process.env.APP_PASSWORD || process.env.AZURE_CLIENT_ID); // the same switch as the proxy: an open local preview has no sign-in
  if (gated && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const params: Record<string, string | string[]> = {};
  for (const k of ["q", "state"]) if (sp.get(k)) params[k] = sp.get(k)!;
  for (const k of ["role", "asset"]) if (sp.getAll(k).length) params[k] = sp.getAll(k);
  const filters = companyFiltersFrom(params);
  const { bytes } = await buildCompanyExport(filters, picksFrom(sp));
  const stamp = new Date().toISOString().slice(0, 10);
  const hint = [filters.roles.join("+"), filters.assets.map((a) => (a === "Not available" ? "no asset classes" : a)).join("+")].filter(Boolean).join(" ");
  const name = `Companies${hint ? ` ${hint}` : ""} ${stamp}.xlsx`.replace(/[\\/:*?"<>|]+/g, " ");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
