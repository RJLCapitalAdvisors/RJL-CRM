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
