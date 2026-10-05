"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { addFactAction, orderFactsAction, removeFactAction, setFactFaqAction, updateFactAction } from "./actions";

export type FaqItem = { id: string; question: string; answer: string; source: string | null; inFaq: boolean };

/**
 * The Investor FAQ, edited in place (Jonathan, Oct 5, 2026: the PDF alone was not something he could fix). Every
 * question and answer is a box you type into; it saves a second after you stop, and the x erases the question for good.
 * Arrows set the order the PDF reads in; "off the FAQ" keeps a question on the ticket but out of the PDF. Questions
 * answered that are not on the FAQ sit underneath, each with a button to put it on. The PDF is built from exactly this
 * list every time it is sent or opened.
 */
export function FaqEditor({ dealId, items }: { dealId: string; items: FaqItem[] }) {
  const [list, setList] = useState<FaqItem[]>(items);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ q: string; a: string } | null>(null);
  const router = useRouter();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 1800);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const edit = (id: string, patch: Partial<Pick<FaqItem, "question" | "answer">>) => {
    setList((l) => l.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const key = `${id}:${Object.keys(patch)[0]}`;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      updateFactAction(dealId, id, patch).then((r) => flash(r.ok ? "Saved" : "Could not save"));
    }, 900);
  };
  const remove = (id: string) => {
    const f = list.find((x) => x.id === id);
    setList((l) => l.filter((x) => x.id !== id));
    start(async () => {
      await removeFactAction(dealId, id);
      flash(`Erased: ${f?.question.slice(0, 40) ?? "question"}`);
    });
  };
  const setFaq = (id: string, inFaq: boolean) => {
    setList((l) => l.map((f) => (f.id === id ? { ...f, inFaq } : f)));
    start(async () => {
      await setFactFaqAction(dealId, id, inFaq);
      flash(inFaq ? "On the FAQ" : "Off the FAQ");
    });
  };
  const move = (id: string, dir: -1 | 1) => {
    const on = list.filter((f) => f.inFaq);
    const i = on.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= on.length) return;
    const next = [...on];
    [next[i], next[j]] = [next[j], next[i]];
    const off = list.filter((f) => !f.inFaq);
    setList([...next, ...off]);
    start(async () => {
      await orderFactsAction(dealId, [...next, ...off].map((f) => f.id));
      flash("Order saved");
    });
  };
  const add = () => {
    if (!draft || !draft.q.trim() || !draft.a.trim()) return;
    const q = draft.q, a = draft.a;
    setDraft(null);
    start(async () => {
      const r = await addFactAction(dealId, q, a);
      if (r.ok && r.id) {
        setList((l) => [...l.filter((f) => f.inFaq), { id: r.id!, question: q, answer: a, source: "typed on the FAQ page", inFaq: true }, ...l.filter((f) => !f.inFaq)]);
        flash("Added");
      }
      router.refresh();
    });
  };

  const on = list.filter((f) => f.inFaq);
  const off = list.filter((f) => !f.inFaq);
  const box = "input w-full resize-y py-1.5 text-sm leading-relaxed";
  // rendered inline (not as a nested component), so a keystroke never remounts the box and drops the caret
  const renderItem = (f: FaqItem, i: number, n: number) => (
    <li key={f.id} className="rounded-md border border-line bg-paper p-3">
      <div className="mb-1.5 flex items-start gap-2">
        <span className="mt-1.5 w-6 shrink-0 text-right text-xs text-muted">{f.inFaq ? `${i + 1}.` : ""}</span>
        <textarea value={f.question} onChange={(e) => edit(f.id, { question: e.target.value })} rows={1} className={`${box} font-semibold`} placeholder="The question" />
        <div className="flex shrink-0 items-center gap-0.5">
          {f.inFaq && (
            <>
              <button type="button" className="btn-ghost p-1" disabled={i === 0} onClick={() => move(f.id, -1)} title="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="btn-ghost p-1" disabled={i === n - 1} onClick={() => move(f.id, 1)} title="Move down">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button type="button" className="btn-ghost px-1.5 py-1 text-[11px]" onClick={() => setFaq(f.id, !f.inFaq)} title={f.inFaq ? "Keep it on the ticket, leave it out of the FAQ" : "Put it on the FAQ"}>
            {f.inFaq ? "off the FAQ" : "on the FAQ"}
          </button>
          <button type="button" className="btn-ghost p-1 text-red-700" onClick={() => remove(f.id)} title="Erase this question for good">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="w-6 shrink-0" />
        <textarea value={f.answer} onChange={(e) => edit(f.id, { answer: e.target.value })} rows={Math.min(8, Math.max(2, Math.ceil(f.answer.length / 110)))} className={box} placeholder="The answer" />
      </div>
      {f.source && <div className="mt-1 pl-8 text-[11px] text-muted">from {f.source}</div>}
    </li>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Type straight into a question or answer; it saves on its own. The x erases a question for good. The PDF investors get is built from this list, in this order, every time.</p>
        <span className="text-xs text-muted">{pending ? "Saving…" : note ?? ""}</span>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">On the FAQ ({on.length})</h2>
        {on.length === 0 && <p className="text-sm text-muted">Nothing on the FAQ yet. Put a question on from the list below, or add one.</p>}
        <ul className="space-y-2">
          {on.map((f, i) => renderItem(f, i, on.length))}
        </ul>
        {draft ? (
          <div className="mt-3 rounded-md border border-sky-600 bg-paper p-3">
            <textarea autoFocus value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} rows={1} className={`${box} mb-2 font-semibold`} placeholder="The question investors ask" />
            <textarea value={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.value })} rows={3} className={box} placeholder="The sponsor's answer" />
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary" disabled={!draft.q.trim() || !draft.a.trim() || pending} onClick={add}>
                Add to the FAQ
              </button>
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-secondary mt-3" onClick={() => setDraft({ q: "", a: "" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add a question
          </button>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Answered on the ticket, not on the FAQ ({off.length})</h2>
        {off.length === 0 && <p className="text-sm text-muted">Everything the sponsor has answered is on the FAQ.</p>}
        <ul className="space-y-2 opacity-80">
          {off.map((f, i) => renderItem(f, i, off.length))}
        </ul>
      </section>
    </div>
  );
}
