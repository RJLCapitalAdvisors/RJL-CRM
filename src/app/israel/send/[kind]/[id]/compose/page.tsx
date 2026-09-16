import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { renderIlTemplate } from "@/lib/il-merge";
import { IlSendClient } from "./send-client";
import { unitFor, type IlKind } from "../unit";

export const metadata = { title: "Send" };
export const dynamic = "force-dynamic";

/**
 * Step two of a send: the email, from the template you pick (RJL Israel > Email templates, the ones for this kind
 * of ticket) with the unit's facts filled in, the person's name left as a token to fill per recipient; the files
 * to go with it; Launch. With no template yet, the built-in summary email.
 */
export default async function IlComposePage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind, id } = await params;
  if (!["apartments", "houses", "projects"].includes(kind)) notFound();
  const sp = await searchParams;
  const ids = String(Array.isArray(sp.to) ? sp.to[0] : sp.to ?? "").split(",").filter(Boolean);
  const wanted = Array.isArray(sp.template) ? sp.template[0] : sp.template;
  const [unit, contacts, me, templates] = await Promise.all([
    unitFor(kind as IlKind, id),
    prisma.ilContact.findMany({ where: { id: { in: ids }, email: { not: null } }, select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } }),
    currentUser(),
    prisma.emailTemplate.findMany({ where: { workspace: "IL", kind, NOT: { name: { startsWith: "(archived)" } } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, subject: true, bodyHtml: true } }),
  ]);
  if (!unit) notFound();
  const tpl = templates.find((t) => t.id === wanted) ?? (wanted === "summary" ? null : templates[0] ?? null);
  const subject = tpl ? renderIlTemplate(tpl.subject, unit.values, me?.name) : unit.email.subject;
  const bodyHtml = tpl ? renderIlTemplate(tpl.bodyHtml, unit.values, me?.name) : unit.email.html.replace(/\{\{\s*first\s*\}\}/g, "{{contact.firstName|there}}");
  const mailbox = me?.accounts.IL ?? me?.israelEmail ?? null;
  const noun = kind === "apartments" ? "apartment" : kind === "houses" ? "house" : "project";
  return (
    <>
      <PageHeader title={`Send ${noun}: ${unit.name}`} subtitle={`${contacts.length} ${contacts.length === 1 ? "person" : "people"}. Pick a template, touch up the words, choose the files, then Launch. Each person gets their own copy with their name filled in.`} />
      <div className="px-8 py-5">
        <IlSendClient
          kind={kind as IlKind}
          id={id}
          unitName={unit.name}
          recipients={contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email!, firstName: c.firstName, lastName: c.lastName, company: c.company?.name ?? null, email: c.email! }))}
          subject={subject}
          bodyHtml={bodyHtml}
          templates={[...templates.map((t) => ({ id: t.id, name: t.name })), { id: "summary", name: "Built-in summary" }]}
          templateId={tpl?.id ?? "summary"}
          files={unit.files}
          mailbox={mailbox}
          backHref={`/israel/send/${kind}/${id}`}
          toParam={ids.join(",")}
        />
      </div>
    </>
  );
}
