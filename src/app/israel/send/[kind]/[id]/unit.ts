import { prisma } from "@/lib/db";
import { usdIls } from "@/lib/fx";
import { apartmentSummary, houseSummary, projectSummary, type SummaryEmail } from "@/lib/israel-summary";
import { ilUnitValues } from "@/lib/il-merge";

export type IlKind = "apartments" | "houses" | "projects";
export type UnitFile = { key: string; label: string; size: number };
export type Unit = { id: string; name: string; kind: IlKind; email: SummaryEmail; files: UnitFile[]; values: Record<string, string> };

/** The unit or project behind a send: its name, the built-in summary email, the token values for a template, and the files that can go with it. */
export async function unitFor(kind: IlKind, id: string): Promise<Unit | null> {
  const [photos, fx] = await Promise.all([
    prisma.ilPhoto.findMany({ where: kind === "apartments" ? { apartmentId: id } : kind === "houses" ? { houseId: id } : { projectId: id }, select: { id: true, name: true, bytes: true }, orderBy: { createdAt: "asc" } }),
    usdIls().catch(() => null),
  ]);
  const photoFiles: UnitFile[] = photos.map((p) => ({ key: `photo:${p.id}`, label: p.name, size: p.bytes.byteLength }));
  const extras = (plan: boolean) => [plan ? (kind === "projects" ? "the brochure" : "the floorplan") : "", photos.length ? "pictures" : ""].filter(Boolean);
  if (kind === "apartments") {
    const a = await prisma.ilApartment.findUnique({ where: { id }, include: { developer: { select: { name: true } } } });
    if (!a) return null;
    const row = a as unknown as Record<string, unknown>;
    const files = [...(a.floorplan ? [{ key: "floorplan", label: a.floorplanName ?? "Floorplan", size: a.floorplan.byteLength }] : []), ...photoFiles];
    return { id, name: a.name, kind, email: apartmentSummary(row, a.developer?.name ?? null, extras(Boolean(a.floorplan))), files, values: ilUnitValues(kind, row, a.developer?.name ?? null, undefined, fx?.ilsPerUsd) };
  }
  if (kind === "houses") {
    const h = await prisma.ilHouse.findUnique({ where: { id }, include: { developer: { select: { name: true } } } });
    if (!h) return null;
    const row = h as unknown as Record<string, unknown>;
    const files = [...(h.floorplan ? [{ key: "floorplan", label: h.floorplanName ?? "Floorplan", size: h.floorplan.byteLength }] : []), ...photoFiles];
    return { id, name: h.name, kind, email: houseSummary(row, h.developer?.name ?? null, extras(Boolean(h.floorplan))), files, values: ilUnitValues(kind, row, h.developer?.name ?? null, undefined, fx?.ilsPerUsd) };
  }
  const p = await prisma.ilProject.findUnique({ where: { id }, include: { developer: { select: { name: true } }, _count: { select: { apartments: true, houses: true } } } });
  if (!p) return null;
  const row = p as unknown as Record<string, unknown>;
  const files = [...(p.brochure ? [{ key: "brochure", label: p.brochureName ?? "Brochure", size: p.brochure.byteLength }] : []), ...photoFiles];
  return { id, name: p.name, kind, email: projectSummary(row, p.developer?.name ?? null, p._count, extras(Boolean(p.brochure))), files, values: ilUnitValues(kind, row, p.developer?.name ?? null, p._count, fx?.ilsPerUsd) };
}

/** The bytes for a chosen file key. */
export async function fileBytes(kind: IlKind, id: string, key: string): Promise<{ name: string; contentType: string; bytes: Uint8Array } | null> {
  if (key.startsWith("photo:")) {
    const p = await prisma.ilPhoto.findUnique({ where: { id: key.slice(6) } });
    return p ? { name: p.name, contentType: p.type, bytes: new Uint8Array(p.bytes) } : null;
  }
  if (key === "floorplan" && kind === "apartments") {
    const a = await prisma.ilApartment.findUnique({ where: { id }, select: { floorplan: true, floorplanType: true, floorplanName: true } });
    return a?.floorplan ? { name: a.floorplanName ?? "floorplan", contentType: a.floorplanType ?? "application/octet-stream", bytes: new Uint8Array(a.floorplan) } : null;
  }
  if (key === "floorplan" && kind === "houses") {
    const h = await prisma.ilHouse.findUnique({ where: { id }, select: { floorplan: true, floorplanType: true, floorplanName: true } });
    return h?.floorplan ? { name: h.floorplanName ?? "floorplan", contentType: h.floorplanType ?? "application/octet-stream", bytes: new Uint8Array(h.floorplan) } : null;
  }
  if (key === "brochure" && kind === "projects") {
    const p = await prisma.ilProject.findUnique({ where: { id }, select: { brochure: true, brochureType: true, brochureName: true } });
    return p?.brochure ? { name: p.brochureName ?? "brochure", contentType: p.brochureType ?? "application/octet-stream", bytes: new Uint8Array(p.brochure) } : null;
  }
  return null;
}
