"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { COMPANY_COLUMNS, DEFAULT_PICKS, EMPLOYEE_COLUMNS, type CompanyColumn, type EmployeeColumn, type ExportLayout } from "@/lib/company-export";

const STORE = "companies-export-picks";

/**
 * Export (Jonathan, Oct 7, 2026): the companies on the list as they are filtered, to an Excel file, with the columns he
 * ticks. Company fields on the left, then the employees we have at each firm, either spread across numbered columns on
 * the company's row or one row per employee. The picks are remembered on this computer.
 */
export function ExportButton({ query, total, summary }: { query: string; total: number; summary: string }) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState<CompanyColumn[]>(DEFAULT_PICKS.company);
  const [employee, setEmployee] = useState<EmployeeColumn[]>(DEFAULT_PICKS.employee);
  const [layout, setLayout] = useState<ExportLayout>(DEFAULT_PICKS.layout);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (saved?.company?.length) setCompany(saved.company.filter((k: string) => COMPANY_COLUMNS.some((c) => c.key === k)));
      if (Array.isArray(saved?.employee)) setEmployee(saved.employee.filter((k: string) => EMPLOYEE_COLUMNS.some((c) => c.key === k)));
      if (saved?.layout === "contact" || saved?.layout === "company") setLayout(saved.layout);
    } catch { /* a private window or blocked storage: the defaults stand */ }
  }, []);
  const remember = (c: CompanyColumn[], e: EmployeeColumn[], l: ExportLayout) => {
    try { localStorage.setItem(STORE, JSON.stringify({ company: c, employee: e, layout: l })); } catch { /* ignore */ }
  };
  const toggleCompany = (k: CompanyColumn) => {
    const next = company.includes(k) ? company.filter((x) => x !== k) : COMPANY_COLUMNS.map((c) => c.key).filter((x) => x === k || company.includes(x));
    setCompany(next);
    remember(next, employee, layout);
  };
  const toggleEmployee = (k: EmployeeColumn) => {
    const next = employee.includes(k) ? employee.filter((x) => x !== k) : EMPLOYEE_COLUMNS.map((c) => c.key).filter((x) => x === k || employee.includes(x));
    setEmployee(next);
    remember(company, next, layout);
  };
  const pickLayout = (l: ExportLayout) => {
    setLayout(l);
    remember(company, employee, l);
  };

  const href = `/api/companies/export?${query}${query ? "&" : ""}cols=${company.join(",")}&emp=${employee.join(",")}&layout=${layout}`;
  const nothing = company.length === 0 && employee.length === 0;

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)} title="The companies on this list, as filtered, to an Excel file">
        Export
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label="Export companies" className="w-full max-w-lg rounded-lg border border-line bg-paper shadow-xl">
            <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-3">
              <h2 className="text-sm font-semibold">Export to Excel</h2>
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 px-4 py-3 text-sm">
              <p className="text-xs text-muted">
                {total.toLocaleString()} compan{total === 1 ? "y" : "ies"} on the list{summary ? ` (${summary})` : ""}. Filter the list first; the export takes exactly what is on it.
                {" "}
                <Link href="/companies?role=Investor&asset=Not%20available" className="text-sky-700 hover:underline" onClick={() => setOpen(false)}>Investors with no asset classes</Link>
              </p>
              <div>
                <div className="label mb-1">Company columns</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {COMPANY_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2">
                      <input type="checkbox" className="accent-ink" checked={company.includes(c.key)} onChange={() => toggleCompany(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1">Employee columns (every contact we have at the firm)</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {EMPLOYEE_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2">
                      <input type="checkbox" className="accent-ink" checked={employee.includes(c.key)} onChange={() => toggleEmployee(c.key)} />
                      Employee {c.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1">Layout</div>
                <label className="flex items-start gap-2">
                  <input type="radio" name="layout" className="mt-1 accent-ink" checked={layout === "company"} onChange={() => pickLayout("company")} />
                  <span>One row per company, employees across the row (Employee 1 email, Employee 1 LinkedIn, Employee 2 email, ...)</span>
                </label>
                <label className="mt-1 flex items-start gap-2">
                  <input type="radio" name="layout" className="mt-1 accent-ink" checked={layout === "contact"} onChange={() => pickLayout("contact")} />
                  <span>One row per employee, the company columns repeated</span>
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                <a href={nothing || total === 0 ? undefined : href} className={`btn-primary inline-flex items-center gap-1.5 ${nothing || total === 0 ? "pointer-events-none opacity-50" : ""}`} onClick={() => setOpen(false)}>
                  <Download className="h-3.5 w-3.5" /> Download Excel
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
