import { prisma } from "@/lib/db";
import { IL_SPONSOR, apartmentMissing, houseMissing, projectMissing } from "@/lib/israel";
import { apartmentData, houseData, projectData, s } from "@/lib/israel-forms";
import { loadIlRequired } from "@/lib/required-items";

/**
 * The public submission forms (Jonathan, Oct 6, 2026): a developer or broker opens /submit/israel/apartment, /house
 * or /project, fills in everything on that kind's Required Items List, drops the floorplan, pictures and documents,
 * and submits. The posted form is read exactly as the ticket forms are (israel-forms.ts), checked against the list
 * the way The Que checks a ticket, and only a complete submission is written: the ticket lands in The Que
 * (pendingApproval) with the files on it, the developer found or made as a Sponsor (Yazam), the submitter found or
 * made as a contact with their firm, and a note saying who sent it.
 */
export type SubmitKind = "apartment" | "house" | "project";
export type SubmitResult = { ok: true; kind: SubmitKind; id: string; name: string } | { ok: false; missing: string[]; error?: string };

const MAX_FILE = 25 * 1024 * 1024;
const isImage = (f: File) => f.type.startsWith("image/");
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

function files(fd: FormData, key: string): File[] {
  return fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
}

async function findOrCreateCompany(name: string | null, role: string): Promise<{ id: string; name: string } | null> {
  const n = name?.trim();
  if (!n) return null;
  const exact = await prisma.ilCompany.findFirst({ where: { name: { equals: n, mode: "insensitive" } }, select: { id: true, name: true, roles: true } });
  if (exact) {
    let roles: string[] = [];
    try { roles = JSON.parse(exact.roles || "[]"); } catch { roles = []; }
    if (!roles.includes(role)) await prisma.ilCompany.update({ where: { id: exact.id }, data: { roles: JSON.stringify([...roles, role]) } });
    return exact;
  }
  return prisma.ilCompany.create({ data: { name: n, roles: JSON.stringify([role]) }, select: { id: true, name: true } });
}

const ROLE_OF: Record<string, string> = { Broker: "Broker", Developer: IL_SPONSOR, Owner: "Seller", Attorney: "Attorneys", Other: "Other" };

/** The person who filled the form in: found by email or phone, else made, with their firm. */
async function submitter(fd: FormData) {
  const name = s(fd, "submitterName") ?? "";
  const email = s(fd, "submitterEmail")?.toLowerCase() ?? null;
  const phone = s(fd, "submitterPhone");
  const company = s(fd, "submitterCompany");
  const role = ROLE_OF[s(fd, "submitterRole") ?? ""] ?? "Broker";
  const firm = await findOrCreateCompany(company, role);
  const existing = (email ? await prisma.ilContact.findFirst({ where: { email } }) : null) ?? (phone && phone.replace(/\D/g, "").length >= 7 ? await prisma.ilContact.findFirst({ where: { phone: { contains: phone.replace(/\D/g, "").slice(-9) } } }) : null);
  if (existing) {
    if (firm && !existing.companyId) await prisma.ilContact.update({ where: { id: existing.id }, data: { companyId: firm.id } });
    return { contact: existing, firm, name: name || [existing.firstName, existing.lastName].filter(Boolean).join(" "), email, phone };
  }
  const [firstName, ...rest] = name.split(/\s+/);
  const contact = await prisma.ilContact.create({ data: { firstName: firstName || null, lastName: rest.join(" ") || null, email, phone, roles: JSON.stringify([role]), companyId: firm?.id ?? null } });
  return { contact, firm, name, email, phone };
}

const who = (sub: { name: string; email: string | null; phone: string | null; firm: { name: string } | null }) => [sub.name, sub.firm?.name, sub.email, sub.phone].filter(Boolean).join(", ");

/** The parking configuration typed on the form has no field of its own: it goes on the description. */
function withParkingNote<T extends { description: string | null }>(data: T, fd: FormData): T {
  const note = s(fd, "parkingNote");
  return note ? { ...data, description: [data.description, `Parking: ${note}`].filter(Boolean).join("\n") } : data;
}

export async function submitIsraelForm(kind: SubmitKind, fd: FormData): Promise<SubmitResult> {
  await loadIlRequired();
  const missing: string[] = [];
  if (!s(fd, "submitterName")) missing.push("Your name");
  if (!s(fd, "submitterEmail") && !s(fd, "submitterPhone")) missing.push("Your email or phone");
  const floorplan = files(fd, "floorplan")[0] ?? null;
  const photos = files(fd, "photos").filter(isImage);
  const documents = files(fd, "documents");
  for (const f of [floorplan, ...photos, ...documents]) if (f && f.size > MAX_FILE) return { ok: false, missing: [], error: `${f.name} is over 25 MB; please send a smaller file.` };
  const developerName = s(fd, "developerName");

  if (kind === "project") {
    const data = withParkingNote(await projectData(fd), fd);
    const developer = await findOrCreateCompany(developerName, IL_SPONSOR);
    const brochure = documents.find(isPdf) ?? null;
    const draft = { ...data, developerId: developer?.id ?? null, brochureName: brochure?.name ?? null };
    missing.push(...projectMissing(draft as unknown as Record<string, unknown>));
    if (missing.length) return { ok: false, missing: [...new Set(missing)] };
    const sub = await submitter(fd);
    const row = await prisma.ilProject.create({
      data: { ...data, developerId: developer?.id ?? null, developerIds: developer ? JSON.stringify([developer.id]) : null, agentContactId: sub.contact.id, pendingApproval: true, ...(brochure ? { brochure: Buffer.from(await brochure.arrayBuffer()), brochureType: brochure.type || "application/pdf", brochureName: brochure.name } : {}) },
      select: { id: true, name: true },
    });
    for (const f of [...photos, ...documents.filter((d) => d !== brochure)]) await prisma.ilPhoto.create({ data: { projectId: row.id, name: f.name, type: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) } });
    await prisma.ilNote.create({ data: { projectId: row.id, body: `Submitted through the project form by ${who(sub)}.` } });
    return { ok: true, kind, id: row.id, name: row.name };
  }

  // apartments and houses
  const projectName = s(fd, "projectName");
  const project = projectName ? await prisma.ilProject.findFirst({ where: { name: { equals: projectName, mode: "insensitive" } }, select: { id: true } }) : null;
  const developer = await findOrCreateCompany(developerName, IL_SPONSOR);
  const plan = floorplan ?? documents.find(isPdf) ?? null;
  if (kind === "apartment") {
    const data = withParkingNote(apartmentData(fd), fd);
    const draft = { ...data, projectId: project?.id ?? null, projectName, developerId: developer?.id ?? null, floorplanName: plan?.name ?? null, floorplanType: plan?.type ?? null };
    missing.push(...apartmentMissing(draft as unknown as Record<string, unknown>));
    if (missing.length) return { ok: false, missing: [...new Set(missing)] };
    const sub = await submitter(fd);
    const row = await prisma.ilApartment.create({
      data: { ...data, projectId: project?.id ?? null, projectName, developerId: developer?.id ?? null, developerIds: developer ? JSON.stringify([developer.id]) : null, agentContactId: sub.contact.id, pendingApproval: true, source: "Submission form", ...(plan ? { floorplan: Buffer.from(await plan.arrayBuffer()), floorplanType: plan.type || "application/octet-stream", floorplanName: plan.name } : {}) },
      select: { id: true, name: true },
    });
    for (const f of [...photos, ...documents.filter((d) => d !== plan)]) await prisma.ilPhoto.create({ data: { apartmentId: row.id, name: f.name, type: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) } });
    await prisma.ilNote.create({ data: { apartmentId: row.id, body: `Submitted through the apartment form by ${who(sub)}.` } });
    return { ok: true, kind, id: row.id, name: row.name };
  }
  const data = withParkingNote(houseData(fd), fd);
  const draft = { ...data, projectId: project?.id ?? null, developerId: developer?.id ?? null, floorplanName: plan?.name ?? null, floorplanType: plan?.type ?? null };
  missing.push(...houseMissing(draft as unknown as Record<string, unknown>));
  if (missing.length) return { ok: false, missing: [...new Set(missing)] };
  const sub = await submitter(fd);
  const row = await prisma.ilHouse.create({
    data: { ...data, projectId: project?.id ?? null, developerId: developer?.id ?? null, developerIds: developer ? JSON.stringify([developer.id]) : null, agentContactId: sub.contact.id, pendingApproval: true, ...(plan ? { floorplan: Buffer.from(await plan.arrayBuffer()), floorplanType: plan.type || "application/octet-stream", floorplanName: plan.name } : {}) },
    select: { id: true, name: true },
  });
  for (const f of [...photos, ...documents.filter((d) => d !== plan)]) await prisma.ilPhoto.create({ data: { houseId: row.id, name: f.name, type: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) } });
  await prisma.ilNote.create({ data: { houseId: row.id, body: `Submitted through the house form by ${who(sub)}.` } });
  return { ok: true, kind, id: row.id, name: row.name };
}
