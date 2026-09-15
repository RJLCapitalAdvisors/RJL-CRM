"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function data(fd: FormData) {
  return {
    name: s(fd, "name") ?? "Untitled template",
    kind: s(fd, "kind") === "BLAST" ? "BLAST" : "DEAL",
    subject: s(fd, "subject") ?? "",
    bodyHtml: (fd.get("bodyHtml") as string | null) ?? "",
  };
}

export async function createTemplate(fd: FormData) {
  const t = await prisma.emailTemplate.create({ data: data(fd) });
  revalidatePath("/templates");
  redirect(`/templates/${t.id}`);
}

export async function updateTemplate(id: string, fd: FormData) {
  await prisma.emailTemplate.update({ where: { id }, data: data(fd) });
  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
}

export async function duplicateTemplate(id: string) {
  const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { id } });
  const copy = await prisma.emailTemplate.create({ data: { name: `${t.name} (copy)`, kind: t.kind, subject: t.subject, bodyHtml: t.bodyHtml } });
  revalidatePath("/templates");
  redirect(`/templates/${copy.id}`);
}

export async function deleteTemplate(id: string) {
  const used = await prisma.campaign.count({ where: { templateId: id } });
  if (used > 0) {
    await prisma.emailTemplate.update({ where: { id }, data: { name: `(archived) ${(await prisma.emailTemplate.findUniqueOrThrow({ where: { id } })).name}` } });
  } else {
    await prisma.emailTemplate.delete({ where: { id } });
  }
  revalidatePath("/templates");
  redirect("/templates");
}

/** The windows on the templates page: a template saves itself as you type. */
export async function saveTemplateInline(id: string, patch: { name?: string; subject?: string; bodyHtml?: string }) {
  const data: Record<string, string> = {};
  if (patch.name != null) data.name = patch.name.trim() || "Untitled template";
  if (patch.subject != null) data.subject = patch.subject;
  if (patch.bodyHtml != null) data.bodyHtml = patch.bodyHtml;
  await prisma.emailTemplate.update({ where: { id }, data });
  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
}

/** The plus square: a new template that opens with a greeting, ready to type into. */
export async function createBlankTemplate() {
  await prisma.emailTemplate.create({ data: { name: "New template", kind: "DEAL", workspace: "CA", subject: "{{deal.subjectLine}}", bodyHtml: "Hi {{contact.firstName|there}},\n\n" } });
  revalidatePath("/templates");
}

/** The x on a window. A template that sent campaigns is kept under an archived name so their history still reads. */
export async function deleteTemplateInline(id: string) {
  const used = await prisma.campaign.count({ where: { templateId: id } });
  if (used > 0) {
    const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { id } });
    await prisma.emailTemplate.update({ where: { id }, data: { name: t.name.startsWith("(archived)") ? t.name : `(archived) ${t.name}` } });
  } else await prisma.emailTemplate.delete({ where: { id } });
  revalidatePath("/templates");
}
