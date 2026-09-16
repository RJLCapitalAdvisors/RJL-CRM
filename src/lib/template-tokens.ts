import { MERGE_FIELDS } from "@/lib/merge";
import type { Token } from "@/components/token-editor";

/**
 * The tokens each templates page offers, grouped the way HubSpot did ("Deal: Sponsor", "Contact: First name").
 * RJL Capital Advisors: everything on the deal ticket, plus the person and the sender. RJL Israel: one set each for
 * projects, apartments and houses (src/lib/il-merge.ts holds the values).
 */
const CONTACT: Token[] = [
  { key: "contact.firstName|there", label: "First name (or \"there\")", group: "Contact" },
  { key: "contact.firstName", label: "First name", group: "Contact" },
  { key: "contact.lastName", label: "Last name", group: "Contact" },
  { key: "company.name", label: "Company", group: "Contact" },
];
const SENDER: Token[] = [{ key: "sender.name", label: "Your name", group: "Sender" }];

export function caTokens(): Token[] {
  const skip = new Set(["contact.firstName", "contact.lastName", "contact.email", "company.name", "sender.name", "unsubscribeUrl"]);
  const deal = MERGE_FIELDS.filter((f) => !skip.has(f.key) && f.key !== "openingLine").map((f) => ({ key: f.key, label: f.label.replace(/\s*\(computed\)$/, ""), group: f.key.startsWith("deal.details.") ? "Checklist" : "Deal" }));
  return [...CONTACT, { key: "openingLine", label: "Personal opening line (set per person on Send deal)", group: "Contact" }, ...deal.filter((d) => d.group === "Deal"), ...deal.filter((d) => d.group === "Checklist"), ...SENDER];
}

const IL_COMMON: Token[] = [
  { key: "unit.name", label: "Name", group: "" },
  { key: "unit.street", label: "Street", group: "" },
  { key: "unit.city", label: "City", group: "" },
  { key: "unit.neighborhood", label: "Neighborhood", group: "" },
  { key: "unit.address", label: "Address (street, city)", group: "" },
  { key: "unit.place", label: "Neighborhood, City", group: "" },
  { key: "unit.developer", label: "Developer", group: "" },
  { key: "unit.completionDate", label: "Built or delivery", group: "" },
  { key: "unit.priceNis", label: "Asking price (₪)", group: "" },
  { key: "unit.priceUsd", label: "Asking price ($)", group: "" },
  { key: "unit.pricePerMeter", label: "Price per m²", group: "" },
  { key: "unit.description", label: "Description", group: "" },
  { key: "unit.facts", label: "Bulleted list of every filled fact", group: "" },
];
const IL_UNIT: Token[] = [
  { key: "unit.rooms", label: "Rooms", group: "" },
  { key: "unit.internalSqm", label: "Internal m²", group: "" },
  { key: "unit.internalSqft", label: "Internal square feet", group: "" },
  { key: "unit.mirpesetSqm", label: "Mirpeset m²", group: "" },
  { key: "unit.sellerType", label: "Seller type", group: "" },
  { key: "unit.parking", label: "Parking", group: "" },
  { key: "unit.mamad", label: "Mamad", group: "" },
  { key: "unit.privatePool", label: "Private pool", group: "" },
];
const IL_KIND: Record<string, Token[]> = {
  apartments: [
    { key: "unit.apartmentType", label: "Apartment type", group: "" },
    { key: "unit.floor", label: "Floor", group: "" },
    { key: "unit.totalFloors", label: "Building stories", group: "" },
    { key: "unit.buildingUnits", label: "Units in the building", group: "" },
    { key: "unit.levels", label: "Levels", group: "" },
    { key: "unit.direction", label: "Direction", group: "" },
    { key: "unit.ceiling", label: "Ceiling height", group: "" },
    { key: "unit.machsan", label: "Machsan", group: "" },
  ],
  houses: [
    { key: "unit.houseType", label: "House type", group: "" },
    { key: "unit.floors", label: "Floors", group: "" },
    { key: "unit.migrashSqm", label: "Migrash m²", group: "" },
    { key: "unit.ceilings", label: "Ceiling heights", group: "" },
  ],
  projects: [
    { key: "unit.totalUnits", label: "Total units", group: "" },
    { key: "unit.stories", label: "Stories", group: "" },
    { key: "unit.parkingSpaces", label: "Parking spaces", group: "" },
    { key: "unit.projectPool", label: "Project pool", group: "" },
    { key: "unit.available", label: "Apartments and houses listed", group: "" },
  ],
};

export function ilTokens(kind: "projects" | "apartments" | "houses"): Token[] {
  const group = kind === "projects" ? "Project" : kind === "houses" ? "House" : "Apartment";
  const own = [...IL_COMMON, ...(kind === "projects" ? [] : IL_UNIT), ...IL_KIND[kind]].map((t) => ({ ...t, group }));
  return [...CONTACT.filter((c) => c.key !== "company.name"), ...own, ...SENDER];
}
