import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { parseList } from "@/lib/taxonomy";
import { checkLabel } from "@/lib/ranges";
import { companiesWhere, type CompanyListFilters } from "@/lib/company-filters";

/**
 * Excel export of the Companies list (Jonathan, Oct 7, 2026). He picks the columns: company fields, and employee fields
 * for every contact we have at the firm. Two layouts: one row per company with the employees spread across numbered
 * columns ("Employee 1 email, Employee 1 LinkedIn, Employee 2 email, ..."), or one row per employee. The first use was
 * the investor companies whose asset classes were never filled in, with each employee's email and LinkedIn, to go and
 * find the answer. People who left the firm are not employees any more and stay out.
 */

export const COMPANY_COLUMNS = [
  { key: "name", label: "Company" },
  { key: "roles", label: "Roles" },
  { key: "assetClasses", label: "Asset classes" },
  { key: "checkSize", label: "Check size" },
  { key: "locations", label: "Deal locations" },
  { key: "website", label: "Website" },
  { key: "linkedin", label: "Company LinkedIn" },
  { key: "location", label: "City, State" },
  { key: "owner", label: "Owner" },
  { key: "lastActivity", label: "Last activity" },
  { key: "contactCount", label: "Number of contacts" },
] as const;

export const EMPLOYEE_COLUMNS = [
  { key: "name", label: "name" },
  { key: "email", label: "email" },
  { key: "title", label: "title" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "phone", label: "phone" },
] as const;

export type CompanyColumn = (typeof COMPANY_COLUMNS)[number]["key"];
export type EmployeeColumn = (typeof EMPLOYEE_COLUMNS)[number]["key"];
export type ExportLayout = "company" | "contact";
export type ExportPicks = { company: CompanyColumn[]; employee: EmployeeColumn[]; layout: ExportLayout };

/** Jonathan's first export: company name, then every employee's email and LinkedIn. */
export const DEFAULT_PICKS: ExportPicks = { company: ["name"], employee: ["email", "linkedin"], layout: "company" };

export function picksFrom(sp: URLSearchParams): ExportPicks {
  const company = (sp.get("cols") ?? "").split(",").filter((k): k is CompanyColumn => COMPANY_COLUMNS.some((c) => c.key === k));
  const employee = (sp.get("emp") ?? "").split(",").filter((k): k is EmployeeColumn => EMPLOYEE_COLUMNS.some((c) => c.key === k));
  const layout: ExportLayout = sp.get("layout") === "contact" ? "contact" : "company";
  return { company: company.length ? company : DEFAULT_PICKS.company, employee, layout };
}

export async function buildCompanyExport(filters: CompanyListFilters, picks: ExportPicks): Promise<{ bytes: Uint8Array; rows: number; companies: number }> {
  const companies = await prisma.company.findMany({
    where: companiesWhere(filters),
    orderBy: { name: "asc" },
    select: {
      name: true, roles: true, website: true, linkedin: true, city: true, state: true, lastActivityAt: true,
      owner: { select: { name: true } },
      criteria: { select: { assetClasses: true, checkSizes: true, checkMinMM: true, checkMaxMM: true, geographyNotes: true } },
      contacts: picks.employee.length || picks.company.includes("contactCount")
        ? { where: { departedAt: null }, orderBy: [{ marketingContact: "desc" }, { lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }], select: { firstName: true, lastName: true, email: true, title: true, linkedin: true, phone: true } }
        : false,
    },
  });
  const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const companyCell = (c: (typeof companies)[number], k: CompanyColumn): string | number => {
    switch (k) {
      case "name": return c.name;
      case "roles": return parseList(c.roles).join(", ");
      case "assetClasses": return parseList(c.criteria?.assetClasses).join(", ");
      case "checkSize": return c.criteria ? checkLabel(c.criteria, "") : "";
      case "locations": return c.criteria?.geographyNotes ?? "";
      case "website": return c.website ?? "";
      case "linkedin": return c.linkedin ?? "";
      case "location": return [c.city, c.state].filter(Boolean).join(", ");
      case "owner": return c.owner?.name ?? "";
      case "lastActivity": return date(c.lastActivityAt);
      case "contactCount": return (c.contacts ?? []).length;
    }
  };
  type Emp = NonNullable<(typeof companies)[number]["contacts"]>[number];
  const employeeCell = (e: Emp, k: EmployeeColumn): string => {
    switch (k) {
      case "name": return [e.firstName, e.lastName].filter(Boolean).join(" ");
      case "email": return e.email ?? "";
      case "title": return e.title ?? "";
      case "linkedin": return e.linkedin ?? "";
      case "phone": return e.phone ?? "";
    }
  };
  const companyLabel = (k: CompanyColumn) => COMPANY_COLUMNS.find((c) => c.key === k)!.label;
  const employeeLabel = (k: EmployeeColumn) => EMPLOYEE_COLUMNS.find((c) => c.key === k)!.label;

  const header: string[] = [];
  const rows: (string | number)[][] = [];
  if (picks.layout === "contact") {
    header.push(...picks.company.map(companyLabel), ...picks.employee.map((k) => `Employee ${employeeLabel(k)}`));
    for (const c of companies) {
      const base = picks.company.map((k) => companyCell(c, k));
      const emps = c.contacts ?? [];
      if (!emps.length || !picks.employee.length) rows.push([...base, ...picks.employee.map(() => "")]);
      else for (const e of emps) rows.push([...base, ...picks.employee.map((k) => employeeCell(e, k))]);
    }
  } else {
    const most = picks.employee.length ? Math.max(0, ...companies.map((c) => (c.contacts ?? []).length)) : 0;
    header.push(...picks.company.map(companyLabel));
    for (let i = 1; i <= most; i++) for (const k of picks.employee) header.push(`Employee ${i} ${employeeLabel(k)}`);
    for (const c of companies) {
      const row: (string | number)[] = picks.company.map((k) => companyCell(c, k));
      const emps = c.contacts ?? [];
      for (let i = 0; i < most; i++) for (const k of picks.employee) row.push(emps[i] ? employeeCell(emps[i], k) : "");
      rows.push(row);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = header.map((h, i) => ({ wch: Math.min(60, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length)) + 2) }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length), c: Math.max(0, header.length - 1) } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Companies");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  return { bytes, rows: rows.length, companies: companies.length };
}
