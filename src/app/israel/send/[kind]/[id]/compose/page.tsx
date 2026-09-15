import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { IlSendClient } from "./send-client";
import { unitFor, type IlKind } from "../unit";

export const metadata = { title: "Send" };
export const dynamic = "force-dynamic";

/** Step two of a send: the email, started from the summary, the files to go with it, and Launch. */
export default async function IlComposePage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind, id } = await params;
  if (!["apartments", "houses", "projects"].includes(kind)) notFound();
  const sp = await searchParams;
  const ids = String(Array.isArray(sp.to) ? sp.to[0] : sp.to ?? "").split(",").filter(Boolean);
  const [unit, contacts, me] = await Promise.all([unitFor(kind as IlKind, id), prisma.ilContact.findMany({ where: { id: { in: ids }, email: { not: null } }, select: { id: true, firstName: true, lastName: true, email: true } }), currentUser()]);
  if (!unit) notFound();
  const mailbox = me?.accounts.IL ?? me?.israelEmail ?? null;
  const noun = kind === "apartments" ? "apartment" : kind === "houses" ? "house" : "project";
  return (
    <>
      <PageHeader title={`Send ${noun}: ${unit.name}`} subtitle={`${contacts.length} ${contacts.length === 1 ? "person" : "people"}. The email starts from the summary; edit it, pick the files, then Launch. Each person gets their own copy with their first name.`} />
      <div className="px-8 py-5">
        <IlSendClient kind={kind as IlKind} id={id} unitName={unit.name} recipients={contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email!, email: c.email! }))} subject={unit.email.subject} text={unit.email.text} files={unit.files} mailbox={mailbox} backHref={`/israel/send/${kind}/${id}`} />
      </div>
    </>
  );
}
