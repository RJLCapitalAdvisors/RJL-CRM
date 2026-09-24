import type { Prisma } from "@prisma/client";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, aqFullName, parseJsonList } from "@/lib/acquisitions";

/**
 * The Contacts sheet's columns and rows, shared by the Contacts list and the Buyers and Operators pipelines
 * (Jonathan, Sep 24, 2026): every field on the contact card is a column, the same everywhere.
 */
export type ContactListRow = Prisma.AqContactGetPayload<{ include: { properties: { include: { property: { select: { address: true } } } }; aqNotes: { select: { body: true } } } }>;
export type CompanyOption = { id: string; name: string; domain: string | null; website: string | null };

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export const PRIORITIES = ["1", "2", "3", "4", "5"] as const;
/** The two pipeline columns: whether the row is in the pipeline, and its 1 to 5 priority (5 highest, at the top). */
export const pipelineColumns = (): GridColumn[] => [
  { key: "pipelinePriority", label: "Priority", type: "select", options: PRIORITIES, width: 90 },
  { key: "pipeline", label: "In Pipeline", type: "select", options: ["Yes", "No"], width: 100 },
];

export function contactColumns(companies: CompanyOption[], operatorsOnly: boolean): GridColumn[] {
  const columns: GridColumn[] = [
    { key: "fullName", label: "Name", type: "readonly", width: 180 },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 160 },
    { key: "firstName", label: "First Name", type: "text", width: 120 },
    { key: "lastName", label: "Last Name", type: "text", width: 130 },
    { key: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name, domain: c.domain ?? c.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null })), width: 200, logoKey: "companyId" },
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
    { key: "properties", label: "Properties", type: "readonly", width: 220 },
    { key: "operatorBrandName", label: "Operator Brand Name", type: "text", width: 180 },
    { key: "website", label: "Website", type: "url", width: 180 },
    { key: "operatorEntityName", label: "Operator Entity Name", type: "text", width: 180 },
    { key: "directoryOperatorName", label: "Directory Operator Name", type: "text", width: 180 },
    { key: "storePhone", label: "Store Phone (Google)", type: "tel", width: 150 },
    { key: "directoryOperatorPhone", label: "Directory Operator Phone", type: "tel", width: 160 },
    { key: "operatorTotalLocations", label: "Operator Total Locations", type: "number", width: 120 },
    { key: "operatorPipelineStatus", label: "Operator Pipeline Status", type: "select", options: AQ_OPERATOR_STATUSES, width: 160 },
    ...pipelineColumns(),
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
    { key: "lastActivityAt", label: "Last Activity", type: "readonly", width: 120 },
  ];
  // on the Operators view the operator details come right after the company
  if (operatorsOnly) {
    const isOp = (c: GridColumn) => c.key.startsWith("operator") || c.key === "website" || c.key.startsWith("directory") || c.key === "storePhone";
    const op = columns.filter(isOp), rest = columns.filter((c) => !isOp(c));
    columns.splice(0, columns.length, ...rest.slice(0, 5), ...op, ...rest.slice(5));
  }
  return columns;
}

export function contactGridRow(c: ContactListRow): GridRow {
  return {
    id: c.id,
    href: `/acquisitions/contacts/${c.id}`,
    fullName: aqFullName(c),
    roles: parseJsonList(c.roles),
    firstName: c.firstName,
    lastName: c.lastName,
    companyId: c.companyId,
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
    properties: c.properties.map((x) => x.property.address).join(", ") || null,
    operatorBrandName: c.operatorBrandName,
    website: c.website,
    operatorEntityName: c.operatorEntityName,
    directoryOperatorName: c.directoryOperatorName,
    storePhone: c.storePhone,
    directoryOperatorPhone: c.directoryOperatorPhone,
    operatorTotalLocations: c.operatorTotalLocations,
    operatorPipelineStatus: c.operatorPipelineStatus,
    pipelinePriority: c.pipelinePriority != null ? String(c.pipelinePriority) : null,
    pipeline: c.pipelineAt ? "Yes" : "No",
    notes: c.notes,
    lastActivityAt: iso(c.lastActivityAt),
  };
}
