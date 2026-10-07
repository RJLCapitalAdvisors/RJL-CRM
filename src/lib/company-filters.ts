import type { Prisma } from "@prisma/client";
import { NO_ASSET_CLASS } from "@/lib/taxonomy";

export type CompanyListFilters = { q: string; roles: string[]; assets: string[]; state: string };

export const listParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const strParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

/** The Companies list's filters as they arrive in the URL (?q=&role=&asset=&state=). */
export function companyFiltersFrom(sp: Record<string, string | string[] | undefined>): CompanyListFilters {
  return { q: strParam(sp.q).trim(), roles: listParam(sp.role), assets: listParam(sp.asset), state: strParam(sp.state) };
}

/** "Not available" in the asset-class filter: the criteria question was never answered (Jonathan, Oct 7, 2026). */
export const noAssetClassesWhere: Prisma.CompanyWhereInput = { OR: [{ criteria: null }, { criteria: { assetClasses: { in: ["[]", ""] } } }] };

/** The Companies list and its export share one definition of "the companies on this list". */
export function companiesWhere(f: CompanyListFilters): Prisma.CompanyWhereInput {
  const named = f.assets.filter((a) => a !== NO_ASSET_CLASS);
  const none = f.assets.includes(NO_ASSET_CLASS);
  return {
    AND: [
      f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { city: { contains: f.q, mode: "insensitive" } }, { contacts: { some: { email: { contains: f.q, mode: "insensitive" } } } }] } : {},
      f.roles.length ? { OR: f.roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
      f.assets.length ? { OR: [...named.map((a) => ({ criteria: { assetClasses: { contains: `"${a}"` } } })), ...(none ? [noAssetClassesWhere] : [])] } : {},
      f.state ? { state: f.state } : {},
    ],
  };
}

/** The same filters back into a query string (the pager and the export link). */
export function companyFiltersQuery(f: CompanyListFilters, extra: Record<string, string> = {}) {
  const u = new URLSearchParams();
  if (f.q) u.set("q", f.q);
  for (const r of f.roles) u.append("role", r);
  for (const a of f.assets) u.append("asset", a);
  if (f.state) u.set("state", f.state);
  for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
  return u;
}
