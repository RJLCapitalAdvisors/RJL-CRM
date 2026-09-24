import type { Prisma } from "@prisma/client";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AQ_ASSET_TYPES, AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, aqFullName, parseJsonList } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";
import { pipelineColumns, type CompanyOption } from "../contacts/columns";

/**
 * The Properties sheet's three panes, shared by the Properties list and the Deals Pipeline (Jonathan, Sep 24, 2026):
 * the property, its owner, its operator; one row per property across all three.
 */
export type PropertyListRow = Prisma.AqPropertyGetPayload<{
  include: {
    companies: { include: { company: { select: { name: true } } } };
    contacts: { include: { contact: { include: { aqNotes: { select: { body: true } } } } } };
    aqNotes: { select: { body: true } };
  };
}>;
type C = PropertyListRow["contacts"][number]["contact"];

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export const companyOptionsOf = (companies: CompanyOption[]) => companies.map((c) => ({ value: c.id, label: c.name, domain: c.domain ?? c.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null }));

export function propertyColumns(dealStages: string[]): GridColumn[] {
  return [
    { key: "address", label: "Property Address", type: "text", width: 220 },
    { key: "city", label: "City", type: "text", width: 130 },
    { key: "state", label: "State", type: "select", options: Object.keys(US_STATES), width: 80 },
    { key: "county", label: "County", type: "text", width: 120 },
    { key: "businessName", label: "Current Business", type: "text", width: 180 },
    { key: "assetType", label: "Asset Type", type: "select", options: AQ_ASSET_TYPES, width: 130 },
    { key: "parcelId", label: "Parcel ID", type: "text", width: 130 },
    { key: "acreage", label: "Acreage", type: "number", width: 90 },
    { key: "squareFeet", label: "Gross SF", type: "number", width: 100 },
    { key: "yearBuilt", label: "Year Built", type: "number", width: 90 },
    { key: "lastSaleDate", label: "Last Sale Date", type: "date", width: 130 },
    { key: "lastSalePrice", label: "Last Sale Price", type: "money", width: 130 },
    { key: "deal", label: "Deal", type: "select", options: ["Deal"], width: 100 },
    { key: "dealStage", label: "Deal Stage", type: "select", options: dealStages, width: 140 },
    ...pipelineColumns(),
    { key: "companies", label: "Companies", type: "readonly", width: 180 },
    { key: "latestNote", label: "Latest Note", type: "readonly", width: 240 },
    { key: "neighborhood", label: "Neighborhood", type: "text", width: 140 },
    { key: "askingPrice", label: "Asking Price", type: "money", width: 130 },
    { key: "units", label: "Units", type: "number", width: 80 },
    { key: "notes", label: "Notes", type: "multiline", width: 220 },
    { key: "updatedAt", label: "Updated", type: "readonly", width: 120 },
  ];
}

/** The contact card's fields, in the same shape as the Contacts sheet. */
export function personColumns(operator: boolean, companies: CompanyOption[]): GridColumn[] {
  return [
    { key: "fullName", label: operator ? "Operator" : "Owner", type: "readonly", width: 180 },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 150 },
    { key: "companyId", label: "Company", type: "select", options: companyOptionsOf(companies), width: 200, logoKey: "companyId" },
    ...(operator
      ? ([
          { key: "operatorBrandName", label: "Operator Brand Name", type: "text", width: 180 },
          { key: "website", label: "Website", type: "url", width: 180 },
          { key: "operatorEntityName", label: "Operator Entity Name", type: "text", width: 180 },
          { key: "directoryOperatorName", label: "Directory Operator Name", type: "text", width: 180 },
          { key: "storePhone", label: "Store Phone (Google)", type: "tel", width: 150 },
          { key: "directoryOperatorPhone", label: "Directory Operator Phone", type: "tel", width: 160 },
          { key: "operatorTotalLocations", label: "Operator Total Locations", type: "number", width: 120 },
          { key: "operatorPipelineStatus", label: "Operator Pipeline Status", type: "select", options: AQ_OPERATOR_STATUSES, width: 160 },
        ] as GridColumn[])
      : []),
    { key: "firstName", label: "First Name", type: "text", width: 120 },
    { key: "lastName", label: "Last Name", type: "text", width: 130 },
    { key: "phone", label: "Primary Phone", type: "tel", width: 140 },
    { key: "secondaryPhone", label: "Secondary Phone", type: "tel", width: 140 },
    { key: "otherPhones", label: "Other Phones", type: "lines", width: 160 },
    { key: "email", label: "Primary Email", type: "email", width: 220 },
    { key: "emails", label: "Email (public record)", type: "lines", width: 220 },
    { key: "mailingAddress", label: "Mailing Address", type: "text", width: 240 },
    { key: "lastCallDate", label: "Last Call Date", type: "date", width: 130 },
    { key: "callResult", label: "Call Result", type: "select", options: AQ_STAGES, width: 140 },
    { key: "callBackAt", label: "Callback Target", type: "date", width: 130 },
    { key: "followUpAt", label: "Follow Up Date", type: "date", width: 130 },
    { key: "latestNote", label: "Latest Call Note", type: "readonly", width: 240 },
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
  ];
}

export function personRow(propertyId: string, c: C | undefined, others: number): GridRow {
  return c
    ? {
        id: propertyId,
        contactId: c.id,
        href: `/acquisitions/contacts/${c.id}`,
        fullName: aqFullName(c) + (others ? ` (+${others})` : ""),
        roles: parseJsonList(c.roles),
        companyId: c.companyId,
        operatorBrandName: c.operatorBrandName,
        website: c.website,
        operatorEntityName: c.operatorEntityName,
        directoryOperatorName: c.directoryOperatorName,
        storePhone: c.storePhone,
        directoryOperatorPhone: c.directoryOperatorPhone,
        operatorTotalLocations: c.operatorTotalLocations,
        operatorPipelineStatus: c.operatorPipelineStatus,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        secondaryPhone: c.secondaryPhone,
        otherPhones: c.otherPhones,
        email: c.email,
        emails: c.emails,
        mailingAddress: c.mailingAddress,
        lastCallDate: iso(c.lastCallDate),
        callResult: c.callResult,
        callBackAt: iso(c.callBackAt),
        followUpAt: iso(c.followUpAt),
        latestNote: c.aqNotes[0]?.body ?? null,
        notes: c.notes,
      }
    : { id: propertyId, contactId: null, href: `/acquisitions/properties/${propertyId}`, fullName: "—" };
}

export const byRole = (p: PropertyListRow, role: string) => p.contacts.map((x) => x.contact).filter((c) => parseJsonList(c.roles).includes(role));

export function propertyGridRow(p: PropertyListRow): GridRow {
  return {
    id: p.id,
    href: `/acquisitions/properties/${p.id}`,
    address: p.address,
    city: p.city,
    state: p.state,
    county: p.county,
    businessName: p.businessName,
    assetType: p.assetType,
    parcelId: p.parcelId,
    acreage: p.acreage,
    squareFeet: p.squareFeet,
    yearBuilt: p.yearBuilt,
    lastSaleDate: iso(p.lastSaleDate),
    lastSalePrice: p.lastSalePrice,
    deal: parseJsonList(p.stages).includes("Deal") ? "Deal" : null,
    dealStage: p.dealStage,
    pipelinePriority: p.pipelinePriority != null ? String(p.pipelinePriority) : null,
    pipeline: p.pipelineAt ? "Yes" : "No",
    companies: p.companies.map((x) => x.company.name).join(", ") || null,
    latestNote: p.aqNotes[0]?.body ?? null,
    neighborhood: p.neighborhood,
    askingPrice: p.askingPrice,
    units: p.units,
    notes: p.notes,
    updatedAt: iso(p.updatedAt),
  };
}

/** The three panes' rows for a page of properties. */
export function paneRows(rows: PropertyListRow[]) {
  return {
    properties: rows.map(propertyGridRow),
    owners: rows.map((p) => { const list = byRole(p, "Owner"); return personRow(p.id, list[0], Math.max(0, list.length - 1)); }),
    operators: rows.map((p) => { const list = byRole(p, "Operator"); return personRow(p.id, list[0], Math.max(0, list.length - 1)); }),
  };
}
export const paneColumns = (dealStages: string[], companies: CompanyOption[]) => ({ properties: propertyColumns(dealStages), owners: personColumns(false, companies), operators: personColumns(true, companies) });
