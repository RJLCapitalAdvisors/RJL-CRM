import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { missingFor } from "@/lib/checklist";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";
import { fmtDate } from "@/lib/format";
import { addTodo, deleteTodo, toggleTodo } from "./todo-actions";

export const dynamic = "force-dynamic";

type Item = { key: string; text: string; detail?: string; href: string; kind: "deal" | "email" | "followup" | "intro" | "review" | "action" };

const DAY = 86_400_000;

/** Everything outstanding, derived from what is in the CRM right now. Email-derived items arrive once Outlook is connected. */
async function derivedItems(): Promise<Item[]> {
  const now = Date.now();
  const [intakes, deals, openQueues, actions] = await Promise.all([
    prisma.dealIntake.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, subject: true, extracted: true, missing: true, fromName: true } }),
    prisma.deal.findMany({
      where: { stage: { in: [...ACTIVE_STAGES] } },
      include: { investors: { include: { contact: { include: { company: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.campaign.findMany({ where: { mode: "OUTREACH", recipients: { some: { status: "PENDING" } } }, include: { deal: true, recipients: { select: { status: true } } } }),
    prisma.dealAction.findMany({ where: { done: false }, include: { deal: { select: { id: true, propertyName: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);

  const items: Item[] = [];

  for (const it of intakes) {
    const ex = JSON.parse(it.extracted) as { propertyName?: string | null; sponsorName?: string | null };
    const missing = JSON.parse(it.missing) as string[];
    items.push({
      key: `intake-${it.id}`,
      kind: "deal",
      text: `Review the ${ex.propertyName ?? it.subject ?? "forwarded"} deal${ex.sponsorName ? ` from ${ex.sponsorName}` : ""}`,
      detail: missing.length ? `${missing.length} checklist items still missing` : "Checklist complete",
      href: `/intake/${it.id}`,
    });
  }

  for (const c of openQueues) {
    const pending = c.recipients.filter((r) => r.status === "PENDING").length;
    items.push({
      key: `queue-${c.id}`,
      kind: "email",
      text: `${c.followUp ? "Finish follow-ups" : "Finish sending"} ${c.deal?.propertyName ?? c.deal?.name ?? c.name}`,
      detail: `${pending} investor${pending === 1 ? "" : "s"} left in the queue`,
      href: `/campaigns/${c.id}`,
    });
  }

  for (const d of deals) {
    const name = d.propertyName ?? d.name;
    const missing = missingFor(d);
    if (d.stage === "Deal Received" && missing.length) {
      items.push({ key: `items-${d.id}`, kind: "deal", text: `Get ${missing.length} outstanding item${missing.length === 1 ? "" : "s"} from ${d.sponsorName ?? "the sponsor"} on ${name}`, detail: missing.slice(0, 3).map((m) => m.label).join(", ") + (missing.length > 3 ? "…" : ""), href: `/deals/${d.id}/tracker` });
    }
    const stale = d.investors.filter((r) => (r.status === 2 || r.status === 3) && now - r.updatedAt.getTime() > 5 * DAY);
    if (stale.length) {
      items.push({ key: `fu-${d.id}`, kind: "followup", text: `Follow up with ${stale.length} investor${stale.length === 1 ? "" : "s"} on ${name}`, detail: `No response in 5+ days: ${stale.slice(0, 3).map((r) => r.contact.company?.name ?? investorLabel(r.contact)).join(", ")}${stale.length > 3 ? "…" : ""}`, href: `/deals/${d.id}/tracker` });
    }
    for (const r of d.investors.filter((r) => r.status === 5)) {
      items.push({ key: `intro-${r.id}`, kind: "intro", text: `Make the intro: ${r.contact.company?.name ?? investorLabel(r.contact)} is interested in ${name}`, detail: r.note ?? undefined, href: `/deals/${d.id}/tracker` });
    }
    if (now - d.updatedAt.getTime() > 30 * DAY && d.stage !== "Deal Received") {
      items.push({ key: `stale-${d.id}`, kind: "review", text: `Still alive? ${name} has had no activity in ${Math.floor((now - d.updatedAt.getTime()) / DAY)} days`, detail: `${d.stage} · ${d.sponsorName ?? ""}`, href: `/deals/${d.id}` });
    }
  }

  for (const a of actions) {
    items.push({ key: `action-${a.id}`, kind: "action", text: a.text, detail: a.deal.propertyName ?? a.deal.name, href: `/deals/${a.deal.id}/tracker` });
  }

  const order: Record<Item["kind"], number> = { deal: 0, email: 1, intro: 2, followup: 3, action: 4, review: 5 };
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}

const kindLabel: Record<Item["kind"], string> = { deal: "Deal", email: "Send", intro: "Intro", followup: "Follow up", review: "Review", action: "Action item" };
const kindTone: Record<Item["kind"], string> = { deal: "bg-sky text-ink", email: "bg-ink text-white", intro: "bg-emerald-100 text-emerald-900", followup: "bg-amber-100 text-amber-900", review: "bg-stone-200 text-ink", action: "bg-sky-50 text-ink" };

export default async function Dashboard() {
  const [items, todos] = await Promise.all([derivedItems(), prisma.todo.findMany({ orderBy: [{ done: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }] })]);
  const open = todos.filter((t) => !t.done);
  const doneRecently = todos.filter((t) => t.done).slice(0, 5);
  const today = new Date();

  return (
    <>
      <PageHeader title="To do" subtitle={`${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${items.length + open.length} open`} />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <form action={addTodo} className="mb-6 flex gap-2">
          <input name="text" placeholder="Add something to do…" className="input" autoComplete="off" />
          <input name="dueDate" type="date" className="input w-44" title="Due date (optional)" />
          <button className="btn-primary" type="submit">
            Add
          </button>
        </form>

        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-paper">
          {open.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <form action={toggleTodo.bind(null, t.id)}>
                <button type="submit" className="mt-0.5 h-4 w-4 rounded border border-line hover:border-ink" aria-label="Done" />
              </form>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{t.text}</div>
                {t.dueDate && <div className={`text-xs ${t.dueDate.getTime() < today.getTime() - DAY ? "text-red-700" : "text-muted"}`}>Due {fmtDate(t.dueDate)}</div>}
              </div>
              <form action={deleteTodo.bind(null, t.id)}>
                <button type="submit" className="text-muted hover:text-red-700" title="Remove">
                  ×
                </button>
              </form>
            </li>
          ))}
          {items.map((it) => (
            <li key={it.key} className="flex items-start gap-3 px-4 py-3">
              <span className={`chip mt-0.5 shrink-0 ${kindTone[it.kind]}`}>{kindLabel[it.kind]}</span>
              <div className="min-w-0 flex-1">
                <Link href={it.href} className="text-sm hover:underline">
                  {it.text}
                </Link>
                {it.detail && <div className="truncate text-xs text-muted">{it.detail}</div>}
              </div>
              <Link href={it.href} className="text-xs text-sky-600 hover:underline">
                Open
              </Link>
            </li>
          ))}
          {items.length + open.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">Nothing outstanding.</li>}
        </ul>

        {doneRecently.length > 0 && (
          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer">Recently done ({todos.filter((t) => t.done).length})</summary>
            <ul className="mt-2 space-y-1">
              {doneRecently.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <form action={toggleTodo.bind(null, t.id)}>
                    <button type="submit" className="text-xs underline">
                      undo
                    </button>
                  </form>
                  <span className="line-through">{t.text}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="mt-6 text-xs text-muted">Items marked Deal, Send, Intro, Follow up, and Review come from what is in the CRM. Once Outlook is connected, unanswered emails and requests sitting in your inbox appear here too.</p>
      </div>
    </>
  );
}
