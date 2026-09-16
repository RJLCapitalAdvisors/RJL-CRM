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
  revalidatePath("/israel/templates");
  revalidatePath("/campaigns/new");
  revalidatePath(`/templates/${id}`);
}

/** The plus square: a new template that opens with a greeting, ready to type into. */
export async function createBlankTemplate(workspace: "CA" | "IL" = "CA", kind = "DEAL") {
  const il = workspace === "IL";
  await prisma.emailTemplate.create({
    data: {
      name: il ? `New ${kind === "projects" ? "project" : kind === "houses" ? "house" : "apartment"} template` : "New template",
      kind: il ? kind : "DEAL",
      workspace,
      subject: il ? "{{unit.name}} in {{unit.place}}" : "{{deal.subjectLine}}",
      bodyHtml: "<div>Hi {{contact.firstName|there}},</div><div><br></div>",
    },
  });
  revalidatePath(il ? "/israel/templates" : "/templates");
}

/** The x on a window. A template that sent campaigns is kept under an archived name so their history still reads. */
export async function deleteTemplateInline(id: string, then?: string) {
  const used = await prisma.campaign.count({ where: { templateId: id } });
  if (used > 0) {
    const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { id } });
    await prisma.emailTemplate.update({ where: { id }, data: { name: t.name.startsWith("(archived)") ? t.name : `(archived) ${t.name}` } });
  } else await prisma.emailTemplate.delete({ where: { id } });
  revalidatePath("/templates");
  revalidatePath("/israel/templates");
  revalidatePath("/campaigns/new");
  if (then) redirect(then);
}

/** New template: a blank one, opened right away. */
export async function createTemplateAndOpen(workspace: "CA" | "IL", kind: string) {
  const il = workspace === "IL";
  const t = await prisma.emailTemplate.create({
    data: {
      name: il ? `New ${kind === "projects" ? "project" : kind === "houses" ? "house" : "apartment"} template` : "New template",
      kind: il ? kind : kind === "BLAST" ? "BLAST" : "DEAL",
      workspace,
      subject: il ? "{{unit.name}} in {{unit.place}}" : kind === "BLAST" ? "" : "{{deal.subjectLine}}",
      bodyHtml: "<div>Hi {{contact.firstName|there}},</div><div><br></div>",
    },
  });
  revalidatePath(il ? "/israel/templates" : kind === "BLAST" ? "/campaigns/new" : "/templates");
  redirect(`/templates/${t.id}`);
}
