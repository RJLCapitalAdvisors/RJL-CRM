"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bold, File, FileImage, FileSpreadsheet, FileText, Italic, List, ListOrdered, PenLine, Presentation, Underline } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { hasMarker, withFirstName, withoutName } from "@/lib/first-name-marker";
import { applyEdits, diffBlocks, greetingName, splitBlocks, type FirmDraft } from "@/lib/firm-draft";
import { Send, Star } from "lucide-react";
import { refreshDealFields } from "@/lib/merge";
import { addFirmAction, launchAction, learnFirstNameAction, previewFollowupEmail, previewGeneralEmail, previewToMeAction, pumpLaunchAction, retryFailedAction, reviseGeneralEmailAction, saveSendStateAction, searchInvestorCompanies } from "./actions";
import { Eye } from "lucide-react";
import { EmailRow, type EmailRowData } from "@/components/email-row";
import { statusOf } from "@/lib/tracker";
import type { LaunchStatus } from "@/lib/launch-queue";

export type Person = { id: string; name: string; firstName?: string; email: string; title: string | null; bounced?: boolean };
export type Firm = { rowId: string; status: number; company: string; domain: string | null; people: Person[]; primaryContactId: string; extraContactIds: string[]; defaultContactIds: string[]; openingLine: string | null; bodyOverride: string | null; draftOpen: boolean; followupTo?: string | null; sentOn?: string | null; sentEmail?: EmailRowData | null };
export type DealFileLite = { key: string; name: string; size: number; url?: string | null };
type Draft = { subject: string; html: string; touched: boolean };
/** Everything on this page that is worth keeping if you leave and come back (kept on the deal, per deal). A firm's draft is its block edits over the General email (an older save may carry a full html copy, converted on load). */
export type SendState = { templateId?: string; general?: Draft | null; drafts?: Record<string, FirmDraft | Draft>; include?: string[]; to?: Record<string, string[]>; primary?: Record<string, string[]>; chosenFiles?: string[]; cc?: string; savedAt?: string };

const GENERAL = "general";

/** The icon a file gets in the attachments row: Excel green, PDF red, Word blue, PowerPoint orange, pictures, anything else grey. */
function FileIcon({ name }: { name: string }) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const cls = "h-4 w-4 shrink-0";
  if (["xlsx", "xlsm", "xls", "csv"].includes(ext)) return <FileSpreadsheet className={`${cls} text-emerald-700`} aria-label="Excel" />;
  if (ext === "pdf") return <FileText className={`${cls} text-red-700`} aria-label="PDF" />;
  if (["doc", "docx"].includes(ext)) return <FileText className={`${cls} text-sky-700`} aria-label="Word" />;
  if (["ppt", "pptx"].includes(ext)) return <Presentation className={`${cls} text-orange-600`} aria-label="PowerPoint" />;
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return <FileImage className={`${cls} text-violet-700`} aria-label="Picture" />;
  return <File className={`${cls} text-muted`} />;
}

/**
 * Send deal. Top: the General token, then one token per firm (logo, name, the people it goes to).
 * General is the email with nobody's name in it: edit it (by hand, or by asking the CRM for a change) and every
 * firm's email follows, each with its own person's first name in the greeting. Click a firm to see its email
 * and tweak just that one; click its caret to pick people, x to leave the firm out.
 * Everything you do here saves itself to the deal a second after you do it, so you can leave and come back.
 * Bottom: "Send preview email to me" (the General one goes with a blank greeting) and LAUNCH (each firm gets its own email).
 */
export function SendClient({ mode = "send", dealId, firms, templates, defaultTemplateId, files, saved, team = [], initialLaunch = null }: { mode?: "send" | "followup"; dealId: string; firms: Firm[]; templates: { id: string; name: string }[]; defaultTemplateId: string; files: DealFileLite[]; saved: SendState | null; team?: { name: string; email: string }[]; initialLaunch?: LaunchStatus | null }) {
  const followup = mode === "followup";
  /** Follow ups: a firm that answered, passed, was already followed up, or has no sent email on record is shaded out and left out by default. */
  const shaded = (f: Firm) => followup && (f.status !== 2 || !f.followupTo);
  /** Follow ups: quiet firms first, then followed up, then the ones that answered, then passes, then firms with no sent email on record. */
  const bucket = (f: Firm) => (!f.followupTo ? 5 : f.status === 2 ? 0 : f.status === 3 ? 1 : f.status === 7 || f.status === 8 ? 4 : f.status === 1 ? 2 : 3);
  const ordered = followup ? [...firms].sort((a, b) => bucket(a) - bucket(b)) : firms;
  /** Follow ups: each token wears its stage colour, see-through; a pass is a light red. */
  const tone = (f: Firm): React.CSSProperties | undefined => {
    if (!followup) return undefined;
    const st = statusOf(f.status);
    const hex = f.status === 7 || f.status === 8 ? "#ffcfc9" : st.bg;
    const n = parseInt(hex.slice(1), 16);
    const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    return { backgroundColor: `rgba(${rgb}, ${shaded(f) ? 0.35 : 0.75})`, borderColor: `rgba(${rgb}, 0.9)` };
  };
  const [chosenFiles, setChosenFiles] = useState<Set<string>>(new Set(saved?.chosenFiles?.filter((k) => files.some((f) => f.key === k)) ?? (followup ? [] : files.slice(0, 6).map((f) => f.key)))); // the FAQ, OM and model first; a whole data room is not the default; a follow-up carries nothing unless ticked
  const [templateId, setTemplateId] = useState(saved?.templateId && templates.some((t) => t.id === saved.templateId) ? saved.templateId : defaultTemplateId);
  const [pickOpen, setPickOpen] = useState(!saved?.templateId); // the template list is open until one has been chosen for this deal
  const savedInclude = saved?.include?.filter((id) => firms.some((f) => f.rowId === id)) ?? [];
  const [include, setInclude] = useState<Set<string>>(new Set(savedInclude.length ? savedInclude : firms.filter((f) => (followup ? !shaded(f) : f.status <= 1)).map((f) => f.rowId)));
  const [to, setTo] = useState<Record<string, Set<string>>>(() => Object.fromEntries(firms.map((f) => [f.rowId, new Set((saved?.to?.[f.rowId] ?? (f.extraContactIds.length ? [f.primaryContactId, ...f.extraContactIds] : f.defaultContactIds)).filter((id) => f.people.some((p) => p.id === id)))])));
  const [general, setGeneral] = useState<Draft | null>(saved?.general ?? null);
  const [cc, setCc] = useState<string>(saved?.cc ?? ""); // copied on every firm's email (teammates, usually)
  const ccList = () => cc.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes("@"));
  const [drafts, setDrafts] = useState<Record<string, FirmDraft>>(() => Object.fromEntries(Object.entries(saved?.drafts ?? {}).map(([k, v]) => [k, "edits" in v ? v : { edits: [], touched: true, html: v.html, subject: v.subject }]))); // firms whose email was edited on its own: block edits over the General email
  // who the greeting addresses at each firm: the row's person, or whoever Jonathan stars (several: "Hi Dave/Jon")
  const [primary, setPrimary] = useState<Record<string, Set<string>>>(() => Object.fromEntries(firms.map((f) => [f.rowId, new Set((saved?.primary?.[f.rowId] ?? [f.primaryContactId]).filter((id) => f.people.some((p) => p.id === id)))])));
  const [learned, setLearned] = useState<Record<string, string>>({}); // first names typed into a greeting this session, by contact id
  const [current, setCurrent] = useState<string>(GENERAL);
  const [picker, setPicker] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string; pending?: boolean; bounced?: string[] }>>({});
  const [launching, setLaunching] = useState(Boolean(initialLaunch && initialLaunch.queued > 0)); // a launch still running resumes when the page opens
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [pending, start] = useTransition();
  const [rendering, setRendering] = useState(false);
  const [reload, setReload] = useState(0); // bump to re-render General from the template
  const [refresh, setRefresh] = useState(0); // bump to pull the ticket's latest numbers into the saved emails (every open, and when the tab comes back)
  const [version, setVersion] = useState(0); // bump to push html into the editor (never on keystrokes, so the caret stays put)
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const editor = useRef<HTMLDivElement>(null);
  const pickerBox = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const known = useRef<Set<string>>(new Set(firms.map((f) => f.rowId)));
  const router = useRouter();

  const cur = current === GENERAL ? null : firms.find((f) => f.rowId === current) ?? null;
  /** The people the greeting addresses: the starred ones among those picked, else the row's person, else the first picked. */
  const primariesFor = (f: Firm): string[] => {
    const picked = to[f.rowId] ?? new Set<string>();
    const starred = [...(primary[f.rowId] ?? new Set<string>())].filter((id) => picked.has(id));
    if (starred.length) return f.people.filter((p) => starred.includes(p.id)).map((p) => p.id);
    if (picked.has(f.primaryContactId)) return [f.primaryContactId];
    const first = f.people.find((p) => picked.has(p.id));
    return first ? [first.id] : [];
  };
  const firstNameOf = (p: Person) => learned[p.id] ?? (p.firstName ?? "").trim();
  /** "Dave", "Dave/Jon", or blank when no first name is known (never an email address). */
  const greetingFor = (f: Firm) => primariesFor(f).map((id) => f.people.find((p) => p.id === id)).filter((p): p is Person => Boolean(p)).map(firstNameOf).filter(Boolean).join("/");
  /** The General email as this firm sees it: its people's names in the greeting. */
  const baseFor = (f: Firm) => (general ? withFirstName(general.html, greetingFor(f)) : "");
  /** A firm's email: the General email with the firm's own block edits laid over it; the General subject unless the firm's own still stands. */
  const draftFor = (f: Firm): Draft | null => {
    if (!general) return null;
    const d = drafts[f.rowId];
    const base = baseFor(f);
    if (d?.html && !d.edits.length) return { subject: d.subject ?? general.subject, html: d.html, touched: true }; // an older save, until converted
    const html = d?.edits.length ? applyEdits(base, d.edits) : base;
    const subject = d?.subject != null && d.subjectBase === general.subject ? d.subject : general.subject;
    return { subject, html, touched: Boolean(d && (d.edits.length || (d.subject != null && d.subjectBase === general.subject))) };
  };
  const shown: Draft | null = cur ? draftFor(cur) : general;

  useEffect(() => {
    if (!general) return;
    setDrafts((s) => {
      let changed = false;
      const n: typeof s = {};
      for (const [k, d] of Object.entries(s)) {
        const f = firms.find((x) => x.rowId === k);
        if (d.html && !d.edits.length && f) {
          const base = baseFor(f);
          n[k] = { edits: diffBlocks(splitBlocks(base).blocks, splitBlocks(d.html).blocks), touched: true, ...(d.subject != null && d.subject !== general.subject ? { subject: d.subject, subjectBase: general.subject } : {}) };
          changed = true;
        } else n[k] = d;
      }
      return changed ? n : s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [general?.html]);

  // a firm added while the page is open (or on the Agreed groups page) gets its default people and is included
  useEffect(() => {
    setTo((s) => {
      const n = { ...s };
      let changed = false;
      for (const f of firms) if (!n[f.rowId]) { n[f.rowId] = new Set(f.defaultContactIds.filter((id) => f.people.some((p) => p.id === id))); changed = true; }
      return changed ? n : s;
    });
    setPrimary((s) => {
      const n = { ...s };
      let changed = false;
      for (const f of firms) if (!n[f.rowId]) { n[f.rowId] = new Set([f.primaryContactId]); changed = true; }
      return changed ? n : s;
    });
    setInclude((s) => {
      const fresh = firms.filter((f) => f.status <= 1 && !known.current.has(f.rowId)).map((f) => f.rowId);
      for (const f of firms) known.current.add(f.rowId);
      return fresh.length ? new Set([...s, ...fresh]) : s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firms]);

  // the General email, from the template. A saved, hand-edited one is kept, but the ticket's numbers in it are
  // replaced by the current ones every time the page opens or the tab comes back (Jonathan, Sep 24, 2026: the ticket
  // autosaves and the email must follow). "reset to template" renders it afresh.
  useEffect(() => {
    let cancelled = false;
    const keepEdits = reload === 0 && Boolean(saved?.general?.touched) && saved?.templateId === templateId;
    const t = setTimeout(() => !cancelled && setRendering(true), 0);
    (followup ? previewFollowupEmail(dealId) : previewGeneralEmail(dealId, templateId))
      .then((r) => {
        if (cancelled) return;
        if (keepEdits) {
          let stale = false;
          setGeneral((g) => {
            if (!g) return { subject: r.subject, html: r.html, touched: false };
            const merged = refreshDealFields(g.html, r.html);
            if (merged == null) {
              stale = true; // saved before the fields were marked: the fresh email replaces it
              return { subject: r.subject, html: r.html, touched: false };
            }
            return merged === g.html ? g : { ...g, html: merged };
          });
          setDrafts((s) => {
            let changed = false;
            const n: typeof s = {};
            for (const [k, d] of Object.entries(s)) {
              if (!d.html) { n[k] = d; continue; } // block edits ride on the General email, which was refreshed above
              const merged = refreshDealFields(d.html, r.html);
              if (merged == null) {
                changed = true; // an old, unmarked firm edit gives way to the General email
                continue;
              }
              n[k] = merged === d.html ? d : { ...d, html: merged };
              if (n[k] !== d) changed = true;
            }
            return changed ? n : s;
          });
          if (stale) setNote("The email was rebuilt from the template with the ticket's current numbers; it had been saved before the ticket fields could be refreshed in place, so earlier hand edits were not kept.");
        } else setGeneral({ subject: r.subject, html: r.html, touched: false });
        setVersion((v) => v + 1);
      })
      .catch(() => null)
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, templateId, reload, refresh]);

  // back from the ticket (another tab, or the browser's back button): the numbers are read again
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);

  // put the html into the editor when the token changes or a fresh version arrives
  useEffect(() => {
    if (editor.current) editor.current.innerHTML = shown?.html ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, version]);

  // autosave: a second after anything changes, the whole state goes onto the deal
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t0 = setTimeout(() => setSaveState("dirty"), 0);
    const t = setTimeout(() => {
      setSaveState("saving");
      const state: SendState = { templateId, general, drafts, include: [...include], to: Object.fromEntries(Object.entries(to).map(([k, v]) => [k, [...v]])), primary: Object.fromEntries(Object.entries(primary).map(([k, v]) => [k, [...v]])), chosenFiles: [...chosenFiles], cc, savedAt: new Date().toISOString() };
      saveSendStateAction(dealId, state, mode)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("dirty"));
    }, 1000);
    return () => {
      clearTimeout(t0);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, general, drafts, include, to, primary, chosenFiles, cc]);

  // the people picker closes on a click anywhere else, or Escape
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      if (pickerBox.current && !pickerBox.current.contains(e.target as Node)) setPicker(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicker(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);

  const commitEdit = () => {
    if (!editor.current) return;
    const html = editor.current.innerHTML;
    if (cur) {
      if (!general) return;
      const base = baseFor(cur);
      const baseBlocks = splitBlocks(base).blocks;
      const firmBlocks = splitBlocks(html).blocks;
      let edits = diffBlocks(baseBlocks, firmBlocks);
      // a first name typed into the greeting belongs to the primary person from now on; the greeting then comes from the General email
      const typed = greetingName(firmBlocks[0] ?? "");
      const ids = primariesFor(cur);
      if (typed && ids.length && typed !== greetingFor(cur) && edits.some((e) => e.base[0] === baseBlocks[0])) {
        const names = typed.split("/");
        if (names.length === ids.length) {
          const learnedNow: Record<string, string> = {};
          ids.forEach((id, k) => { learnedNow[id] = names[k]; learnFirstNameAction(id, names[k]).catch(() => null); });
          setLearned((s) => ({ ...s, ...learnedNow }));
          const after = withFirstName(general.html, names.join("/"));
          edits = diffBlocks(splitBlocks(after).blocks, firmBlocks);
          setNote(`${names.join(" and ")} saved as the first name${names.length > 1 ? "s" : ""} of ${ids.map((id) => cur.people.find((p) => p.id === id)?.email ?? "").filter(Boolean).join(" and ")}.`);
        }
      }
      setDrafts((s) => {
        const prev = s[cur.rowId];
        const keepSubject = prev?.subject != null && prev.subjectBase === general.subject ? { subject: prev.subject, subjectBase: prev.subjectBase } : {};
        if (!edits.length && !("subject" in keepSubject)) {
          if (!prev) return s;
          const n = { ...s };
          delete n[cur.rowId];
          return n;
        }
        return { ...s, [cur.rowId]: { edits, touched: true, ...keepSubject } };
      });
    } else {
      setGeneral((g) => (g && g.html === html ? g : { subject: g?.subject ?? "", html, touched: true }));
    }
  };

  const togglePrimary = (rowId: string, pid: string) =>
    setPrimary((s) => {
      const n = new Set(s[rowId] ?? []);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return { ...s, [rowId]: n };
    });

  // a group added right here: its usual person joins the report and a token appears
  const [addQ, setAddQ] = useState("");
  const [addOpts, setAddOpts] = useState<{ id: string; name: string }[]>([]);
  const addTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAdd = (v: string) => {
    setAddQ(v);
    if (addTimer.current) clearTimeout(addTimer.current);
    if (!v.trim()) return setAddOpts([]);
    addTimer.current = setTimeout(() => searchInvestorCompanies(v).then((r) => setAddOpts(r.filter((o) => !firms.some((f) => f.company === o.name)))), 200);
  };
  const addFirm = (o: { id: string; name: string }) => {
    setAddQ("");
    setAddOpts([]);
    start(async () => {
      const r = await addFirmAction(dealId, o.id);
      setNote(r.ok ? `${o.name} added; pick who gets it (▾) and send with its ➤, or include it in the launch.` : r.reason ?? "Could not add that firm.");
      router.refresh();
    });
  };

  // one firm, now: two clicks within ten seconds, like LAUNCH
  const [armedOne, setArmedOne] = useState<{ rowId: string; at: number } | null>(null);
  const sendOne = (f: Firm) => {
    commitEdit();
    const d = draftFor(f);
    const ids = [...(to[f.rowId] ?? [])].filter((id) => !f.people.find((p) => p.id === id)?.bounced);
    if (!ids.length) {
      setPicker(f.rowId);
      return setNote(`Pick who at ${f.company} gets it first (▾), then click ➤ again.`);
    }
    if (!armedOne || armedOne.rowId !== f.rowId || Date.now() - armedOne.at > 10_000) {
      setArmedOne({ rowId: f.rowId, at: Date.now() });
      return setNote(`Ready to send ${f.company}'s email to ${ids.map((id) => f.people.find((p) => p.id === id)?.name.split(" ")[0] ?? "").filter(Boolean).join(", ")}. Click ➤ on ${f.company} again to send it.`);
    }
    setArmedOne(null);
    start(async () => {
      const r = await launchAction(dealId, [{ rowId: f.rowId, toContactIds: ids, subject: d?.subject ?? "", html: d?.html ?? "", cc: ccList() }], [...chosenFiles], mode);
      if (!r.ok) return setNote(r.reason);
      applyStatus(r.status);
      if (r.status.queued > 0) setLaunching(true);
    });
  };

  const togglePerson = (rowId: string, pid: string) =>
    setTo((s) => {
      const n = new Set(s[rowId] ?? []);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return { ...s, [rowId]: n };
    });

  const itemsToSend = () =>
    firms
      .filter((f) => include.has(f.rowId))
      .map((f) => {
        const d = draftFor(f);
        return { rowId: f.rowId, toContactIds: [...(to[f.rowId] ?? [])], subject: d?.subject ?? "", html: d?.html ?? "", cc: ccList() };
      });

  // first click arms the launch and says what will go; the second click within ten seconds sends. Browser confirm dialogs
  // are blocked in some windows and left the button doing nothing (Carderock, Sep 16), so every stop is a visible note.
  const [armed, setArmed] = useState<number | null>(null);
  const launch = () => {
    commitEdit();
    const items = itemsToSend();
    if (!items.length) return setNote("Nothing to send: no firm is ticked, or the ticked firms were already sent.");
    if (!general) return setNote("The General email is still rendering. Give it a moment, or click 'reset to template'.");
    const noPeople = items.filter((i) => !i.toContactIds.length);
    if (noPeople.length) return setNote(`${noPeople.length} firm${noPeople.length === 1 ? " has" : "s have"} nobody picked: use the ▾ on the firm to pick who gets it, or x to leave it out.`);
    if (!armed || Date.now() - armed > 10_000) {
      setArmed(Date.now());
      setNote(`Ready: ${items.length} individual email${items.length === 1 ? "" : "s"}, one every 30 seconds, ${chosenFiles.size} attachment${chosenFiles.size === 1 ? "" : "s"} each. Click LAUNCH again to send.`);
      return;
    }
    setArmed(null);
    start(async () => {
      try {
        const r = await launchAction(dealId, items, [...chosenFiles], mode);
        if (!r.ok) return setNote(r.reason);
        applyStatus(r.status);
        if (r.status.queued > 0) setLaunching(true);
        else router.refresh();
      } catch (e) {
        setNote(`Launch did not start: ${e instanceof Error ? e.message : String(e)}. Nothing was sent. Try again, or tell Claude what this says.`);
      }
    });
  };

  /** The launch as it stands: which firms are sent, queued or failed, and when the next one goes. */
  const applyStatus = (st: LaunchStatus) => {
    setResults(Object.fromEntries(st.rows.map((x) => [x.rowId, { ok: x.status === "SENT", error: x.status === "FAILED" || x.status === "BOUNCED" ? x.error ?? "failed" : undefined, pending: x.status === "QUEUED" || x.status === "SENDING", bounced: x.bounced }])));
    // people whose address bounced come off the firm's picks, so "send again" goes to someone else there
    const bouncedIds = new Set(firms.flatMap((f) => f.people.filter((p) => p.bounced || (st.rows.find((x) => x.rowId === f.rowId)?.bounced ?? []).includes(p.email.toLowerCase())).map((p) => p.id)));
    if (bouncedIds.size) setTo((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, new Set([...v].filter((id) => !bouncedIds.has(id)))])));
    const trouble = st.rows.filter((x) => x.status === "FAILED" || x.status === "BOUNCED").map((x) => `${firms.find((f) => f.rowId === x.rowId)?.company ?? "a firm"} (${x.error ?? x.status.toLowerCase()})`);
    const held = st.heldUntil ? new Date(st.heldUntil) : null;
    setNextAt(st.queued > 0 && !held ? Date.now() + st.nextInMs : null);
    setNote(
      st.queued > 0
        ? held
          ? `${st.sent} of ${st.total} sent · ${st.queued} waiting. Microsoft paused attachment uploads from your mailbox for a few minutes (too many megabytes in a short time); sending resumes on its own at ${held.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Nothing is lost; the server keeps going whether or not this page is open.`
          : `${st.sent} of ${st.total} sent · ${st.queued} to go. One email at a time, spaced for the attachments' size, so each lands as an individually sent email. The server keeps going if you leave or your laptop sleeps.`
        : `${st.sent} of ${st.total} sent.${trouble.length ? ` Needs another go: ${trouble.join("; ")}. Use the ▾ on the firm to pick who gets it (the same people or others there), then "send again" on that firm.` : ""}`,
    );
  };
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (nextAt == null) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [nextAt]);
  const countdown = nextAt != null ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : null;
  void tick;
  // a launch that already ran (with something failed or bounced) shows its results when the page opens
  useEffect(() => {
    if (initialLaunch) applyStatus(initialLaunch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One firm again: the email as it stands now, to the people picked for it (after a bounce, or a failure). */
  const sendAgain = (f: Firm) => {
    commitEdit();
    const d = draftFor(f);
    const ids = [...(to[f.rowId] ?? [])].filter((id) => !f.people.find((p) => p.id === id)?.bounced);
    if (!ids.length) {
      setPicker(f.rowId);
      return setNote(`Pick who at ${f.company} gets it first (▾), then click send again.`);
    }
    start(async () => {
      const r = await launchAction(dealId, [{ rowId: f.rowId, toContactIds: ids, subject: d?.subject ?? "", html: d?.html ?? "", cc: ccList() }], [...chosenFiles], mode);
      if (!r.ok) return setNote(r.reason);
      applyStatus(r.status);
      if (r.status.queued > 0) setLaunching(true);
    });
  };
  useEffect(() => {
    if (!launching) return;
    let live = true;
    const tick = async () => {
      const st = await pumpLaunchAction(dealId, mode).catch(() => null);
      if (!live || !st) return;
      applyStatus(st);
      if (st.queued === 0) {
        setLaunching(false);
        router.refresh();
      }
    };
    const t = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launching, dealId]);

  const previewToMe = () => {
    commitEdit();
    const d = cur ? draftFor(cur) : general;
    if (!d?.html) return;
    const html = cur ? d.html : withoutName(d.html);
    start(async () => {
      const r = await previewToMeAction(dealId, { rowId: cur?.rowId ?? GENERAL, toContactIds: cur ? [...(to[cur.rowId] ?? [])] : [], subject: d.subject, html }, [...chosenFiles]);
      setNote(r.ok ? `Preview of the ${cur ? `${cur.company} email` : "General email (no name in the greeting)"} sent to your inbox.` : r.error ?? "Could not send the preview.");
    });
  };

  const revise = () => {
    commitEdit();
    const html = editor.current?.innerHTML ?? general?.html ?? "";
    if (!general || !html || !ask.trim()) return;
    start(async () => {
      const r = await reviseGeneralEmailAction(dealId, general.subject, html, ask);
      if ("error" in r) return setNote(r.error);
      setGeneral({ subject: r.subject, html: r.html, touched: true });
      setVersion((v) => v + 1); // every firm follows the revised General email; a firm's own edits stay only where their blocks still match
      setAsk("");
      setNote(hasMarker(r.html) ? "Revised. Every firm's email now follows this version." : "Revised, but the greeting lost its name slot: each email will open with 'Hi there'. Reset to template if that is not what you want.");
    });
  };

  const setSubject = (value: string) => {
    if (cur) {
      if (!general) return;
      setDrafts((s) => {
        const prev = s[cur.rowId];
        if (value === general.subject) {
          if (!prev) return s;
          const rest = { edits: prev.edits, touched: true as const };
          if (!prev.edits.length) { const n = { ...s }; delete n[cur.rowId]; return n; }
          return { ...s, [cur.rowId]: rest };
        }
        return { ...s, [cur.rowId]: { edits: prev?.edits ?? [], touched: true, subject: value, subjectBase: general.subject } };
      });
    } else setGeneral((g) => ({ subject: value, html: g?.html ?? "", touched: true }));
  };

  const resetShown = () => {
    if (cur) {
      setDrafts((s) => {
        const n = { ...s };
        delete n[cur.rowId];
        return n;
      });
      setVersion((v) => v + 1);
    } else {
      setDrafts({});
      setReload((n) => n + 1);
    }
  };

  // font and size for the selected words (or what you type next). Size goes in as a span with a pt value, which Outlook honors; the browser's own size command only knows 1 to 7.
  const FONTS = ["Calibri", "Arial", "Georgia", "Tahoma", "Times New Roman", "Verdana"];
  const SIZES = ["9", "10", "11", "12", "14", "16", "18"];
  const [fontName, setFontName] = useState("Calibri");
  const [fontSize, setFontSize] = useState("11");
  // the paragraphs and bullets the selection touches (the one at the caret when nothing is selected); styling those
  // leaves the bold lead-ins and the rest of the inline markup exactly as the template had them
  const blocksInSelection = (): HTMLElement[] => {
    const root = editor.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    const blocks = [...root.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4")].filter((el) => range.intersectsNode(el) && !el.querySelector("p, li"));
    if (blocks.length) return blocks;
    let node: Node | null = range.startContainer;
    while (node && node !== root) {
      if (node instanceof HTMLElement && /^(P|LI|DIV|H[1-6])$/.test(node.tagName)) return [node];
      node = node.parentNode;
    }
    return root ? [root] : [];
  };
  const applyFontName = (name: string) => {
    setFontName(name);
    editor.current?.focus();
    for (const el of blocksInSelection()) el.style.fontFamily = `${name}, Arial, sans-serif`;
    commitEdit();
  };
  const applyFontSize = (pt: string) => {
    setFontSize(pt);
    editor.current?.focus();
    for (const el of blocksInSelection()) el.style.fontSize = `${pt}pt`;
    commitEdit();
  };
  // the toolbar shows the font and size at the caret
  const readCaretFont = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    if (!el || !editor.current?.contains(el)) return;
    const cs = window.getComputedStyle(el);
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    setFontName(FONTS.includes(fam) ? fam : "Calibri");
    const pt = Math.round((parseFloat(cs.fontSize) * 72) / 96).toString();
    setFontSize(SIZES.includes(pt) ? pt : "11");
  };

  const pill = (selected: boolean, on = true) => `flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-1 text-sm ${selected ? "border-sky-600 bg-sky" : on ? "border-line bg-paper" : "border-line bg-cream-50 opacity-60"}`;
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "dirty" ? "Unsaved changes" : saved?.savedAt ? `Saved ${new Date(saved.savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";

  return (
    <div className="space-y-3 px-5 py-4">
      {/* recipients */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>
            Sending individually to {include.size} firm{include.size === 1 ? "" : "s"}. General is everyone&apos;s starting point; click a firm to see and tweak its own email; the arrow picks people; x leaves it out.
          </span>
          <div className="flex items-center gap-3">
            {saveLabel && <span className={saveState === "dirty" ? "text-amber-700" : "text-muted"}>{saveLabel}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className={`${pill(current === GENERAL)} min-w-[480px] pr-3`}>
            <button type="button" className="flex w-full items-center gap-2" onClick={() => setCurrent(GENERAL)} title="The email everyone gets, with no name in the greeting. Edit it once here.">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink text-white">
                <PenLine className="h-3 w-3" />
              </span>
              <span className="font-medium">General</span>
              <span className="text-xs text-muted">{general?.touched ? "edited here, so every firm's email follows" : "the one email everyone gets; edit it once here"}</span>
            </button>
          </div>
          {ordered.map((f) => {
            const on = include.has(f.rowId);
            const chosen = f.people.filter((p) => (to[f.rowId] ?? new Set()).has(p.id));
            const res = results[f.rowId];
            const selected = current === f.rowId;
            return (
              <div key={f.rowId} className="relative">
                <div style={tone(f)} className={`${pill(selected, on)} ${res?.ok ? "border-emerald-500" : ""} ${shaded(f) && !on ? "opacity-60" : ""}`} title={shaded(f) ? (f.followupTo ? "Answered, passed or already followed up: left out unless you turn it on with +" : "No sent deal email on record for this firm: a follow-up cannot reply to it") : undefined}>
                  <button type="button" className="flex items-center gap-1.5" onClick={() => setCurrent(f.rowId)} title={f.status >= 2 ? "Sent earlier; the + sends it again with the current email" : "Show this firm's email"}>
                    <CompanyLogo domain={f.domain} name={f.company} size={18} />
                    <span className="font-medium">{f.company}</span>
                    <span className="text-xs text-muted">{chosen.length ? chosen.map((p) => p.name.split(" ")[0]).join(", ") : "nobody picked"}</span>
                    {draftFor(f)?.touched && !res && <span className="text-xs text-sky-700" title="This firm's email has its own edits on top of the General email">edited</span>}
                    {res?.ok && <span className="text-xs text-emerald-700">sent</span>}
                    {res?.pending && <span className="text-xs text-sky-700">queued</span>}
                    {res && !res.ok && !res.pending && <span className="text-xs text-red-700" title={res.error}>{res.bounced?.length ? "bounced" : "failed"}</span>}
                    {!followup && f.status >= 2 && !res && <span className="text-xs text-muted">{on ? "sending again" : "sent earlier"}</span>}
                    {followup && !res && <span className="text-xs text-muted">{!f.followupTo ? "no sent email on record" : f.status === 2 ? `sent ${f.sentOn ? new Date(f.sentOn).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "earlier"}, quiet` : f.status === 3 ? "followed up" : f.status >= 7 ? "passed" : "answered"}</span>}
                  </button>
                  {(
                    <>
                      <button type="button" className="rounded-full px-1 text-xs text-muted hover:bg-cream" onClick={() => setPicker(picker === f.rowId ? null : f.rowId)} title="Pick who at this firm gets it">
                        ▾
                      </button>
                      <button type="button" className="rounded-full px-1 text-xs text-muted hover:bg-cream" onClick={() => setInclude((s) => { const n = new Set(s); if (n.has(f.rowId)) n.delete(f.rowId); else n.add(f.rowId); return n; })} title={on ? "Leave this firm out" : "Include this firm"}>
                        {on ? "×" : "+"}
                      </button>
                      {res && !res.ok && !res.pending && !launching && (
                        <button type="button" className="rounded-full px-1.5 text-xs text-red-700 hover:bg-cream" disabled={pending} onClick={() => sendAgain(f)} title={res.bounced?.length ? `Bounced for ${res.bounced.join(", ")}: pick other people at ${f.company} (▾) and send the email again` : `Failed: ${res.error}. Send it again to the people picked`}>
                          send again
                        </button>
                      )}
                      {!launching && !(res && !res.ok && !res.pending) && (
                        <button type="button" className={`rounded-full px-1 text-xs hover:bg-cream ${armedOne?.rowId === f.rowId ? "text-red-700" : "text-muted"}`} disabled={pending} onClick={() => sendOne(f)} title={`Send ${f.company} its email now, on its own (two clicks)`}>
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {picker === f.rowId && (
                  <div ref={pickerBox} className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-line bg-paper p-2 shadow-lg">
                    <div className="mb-1 text-xs text-muted">Who at {f.company} gets it; the star says who the greeting addresses (click anywhere else to close)</div>
                    {f.people.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
                        <input type="checkbox" className="accent-ink" checked={(to[f.rowId] ?? new Set()).has(p.id)} onChange={() => togglePerson(f.rowId, p.id)} />
                        <button type="button" className={`shrink-0 ${primariesFor(f).includes(p.id) ? "text-amber-500" : "text-line hover:text-amber-400"}`} title={primariesFor(f).includes(p.id) ? "Addressed to this person (click to unstar)" : "Address the greeting to this person too (several: Hi Dave/Jon)"} onClick={(e) => { e.preventDefault(); if (!(to[f.rowId] ?? new Set()).has(p.id)) togglePerson(f.rowId, p.id); togglePrimary(f.rowId, p.id); }}>
                          <Star className="h-3.5 w-3.5" fill={primariesFor(f).includes(p.id) ? "currentColor" : "none"} />
                        </button>
                        <span className="min-w-0 flex-1 truncate">
                          {p.name} <span className="text-xs text-muted">{p.title ?? p.email}</span>
                          {(p.bounced || (results[f.rowId]?.bounced ?? []).includes(p.email.toLowerCase())) && <span className="ml-1 text-xs text-red-700" title="The deal email to this address bounced; they have probably left">bounced</span>}
                        </span>
                      </label>
                    ))}
                    {f.people.length === 0 && <div className="text-xs text-red-700">Nobody with an email at this firm.</div>}
                  </div>
                )}
              </div>
            );
          })}
          {firms.length === 0 && <span className="text-sm text-muted">No groups on this deal yet. Finalize the engagement letter first.</span>}
          <div className="relative">
            <input value={addQ} onChange={(e) => searchAdd(e.target.value)} placeholder="Add a group…" className="input w-44 py-1 text-sm" title="Add a firm to this deal: it joins the progress report and gets a token here" />
            {addOpts.length > 0 && (
              <ul className="absolute left-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-line bg-paper shadow-lg">
                {addOpts.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => addFirm(o)}>
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* attachments: only what the sponsor sent us on this deal */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
        <span className="text-xs text-muted">Attachments</span>
        {files.length === 0 && <span className="text-xs text-muted">No files from the sponsor on this deal yet (they arrive through deals@).</span>}
        {files.map((f) => (
          <label key={f.key} className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" className="accent-ink" checked={chosenFiles.has(f.key)} onChange={() => setChosenFiles((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} />
            <FileIcon name={f.name} />
            <span>{f.name}</span>
            {f.url && (
              <a href={f.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="See this file before you send it (opens in a new tab)" onClick={(e) => e.stopPropagation()}>
                <Eye className="h-3.5 w-3.5" />
              </a>
            )}
            <span className="text-xs text-muted">{f.size >= 1_000_000 ? `${(f.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1000))} KB`}</span>
          </label>
        ))}
      </div>

      {/* the template: the General email is that exact template with the deal's facts filled in (a follow-up has no template: one line above the quoted deal email) */}
      {!followup && <div className="card px-4 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted">Template</span>
          <span className="font-medium">{templates.find((t) => t.id === templateId)?.name ?? "none chosen yet"}</span>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setPickOpen((o) => !o)}>
            {pickOpen ? "Close" : "Change template"}
          </button>
          <span className="text-xs text-muted">The email below is this template with the deal filled in; every firm's copy follows it.</span>
          <a href="/templates" className="ml-auto text-xs text-sky-700 hover:underline">
            Edit templates
          </a>
        </div>
        {pickOpen && (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  setDrafts({});
                  setPickOpen(false);
                }}
                className={`rounded-md border px-3 py-2 text-left text-sm ${t.id === templateId ? "border-sky-600 bg-sky font-medium" : "border-line bg-paper hover:bg-cream"}`}
              >
                {t.name}
              </button>
            ))}
            {templates.length === 0 && <div className="text-xs text-muted">No deal templates yet. Add one under Templates.</div>}
          </div>
        )}
      </div>}
      {followup && (
        <div className="card px-4 py-2.5 text-sm text-muted">
          Each follow-up goes out as a <b>reply all</b> on the deal email that firm was sent, so the original sits quoted underneath and the thread stays one. The line below is written above it, with the person&apos;s first name. Firms with no sent email on record are shaded and cannot be followed up here.
        </div>
      )}

      {/* the email: General (with the ask-the-CRM box alongside), or the selected firm's */}
      <div className={cur ? "" : "grid grid-cols-[260px_1fr] gap-4"}>
        {!cur && (
          <div className="sticky top-4 self-start">
            <div className="card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <PenLine className="h-4 w-4" /> Ask the CRM to change this email
              </div>
              <p className="mb-2 text-xs text-muted">Say what to change and Claude rewrites the General email. Every firm&apos;s email follows.</p>
              <textarea
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                rows={5}
                placeholder="e.g. emphasize the business plan more, shorten the sponsor background, lead with the yield on cost"
                className="input min-h-[110px] w-full resize-y py-1.5 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    revise();
                  }
                }}
              />
              <button type="button" className="btn-primary mt-2 w-full justify-center" disabled={pending || !general || !ask.trim()} onClick={revise}>
                {pending ? "Working…" : "Revise"}
              </button>
              <p className="mt-2 text-[11px] text-muted">Enter sends. Shift+Enter for a new line.</p>
            </div>
          </div>
        )}
        <div className="card min-w-0">
          {followup && cur && (
            <div className="border-b border-line bg-cream-50 px-4 py-2">
              <div className="mb-1 text-xs font-semibold text-muted">Replying all on this email, the deal email {cur.company} was sent</div>
              {cur.sentEmail ? (
                <ul className="divide-y divide-line rounded-md border border-line bg-paper">
                  <EmailRow e={cur.sentEmail} />
                </ul>
              ) : (
                <div className="text-xs text-red-700">No sent deal email on record for {cur.company}: a follow-up cannot be sent from here.</div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              {cur ? <CompanyLogo domain={cur.domain} name={cur.company} size={18} /> : <PenLine className="h-4 w-4" />}
              <span className="font-semibold">{cur ? `${followup ? "Follow-up to" : "Email to"} ${cur.company}` : followup ? "General follow-up" : "General email"}</span>
              {cur ? (
                <span className="text-xs text-muted">to {cur.people.filter((p) => (to[cur.rowId] ?? new Set()).has(p.id)).map((p) => p.email).join(", ") || "nobody picked"}</span>
              ) : (
                <span className="text-xs text-muted">no name in the greeting; each firm gets this with its starred people&apos;s first names, and every edit here reaches every firm</span>
              )}
            </div>
            {shown?.touched && (
              <button type="button" className="text-xs text-muted hover:underline" onClick={resetShown}>
                {cur ? "back to the General email" : "reset to template"}
              </button>
            )}
          </div>
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="w-14 text-xs text-muted">Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Copied on every firm's email, e.g. aviel@rjlcapadvisors.com" className="input py-1" />
              {team.filter((t) => !ccList().some((x) => x.toLowerCase() === t.email.toLowerCase())).map((t) => (
                <button key={t.email} type="button" className="chip shrink-0 text-[11px] hover:bg-cream" onClick={() => setCc((v) => (v.trim() ? `${v.trim().replace(/[,;]$/, "")}, ${t.email}` : t.email))} title={`Copy ${t.name}`}>
                  + {t.name.split(" ")[0]}
                </button>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="w-14 text-xs text-muted">Subject</span>
              <input value={shown?.subject ?? ""} onChange={(e) => setSubject(e.target.value)} className="input py-1" />
            </div>
            <div className="rounded-md border border-line bg-white focus-within:border-sky-600">
              <div className="flex items-center gap-0.5 border-b border-line bg-cream-50 px-2 py-1">
                {(
                  [
                    ["bold", "Bold", Bold],
                    ["italic", "Italic", Italic],
                    ["underline", "Underline", Underline],
                    ["insertUnorderedList", "Bulleted list", List],
                    ["insertOrderedList", "Numbered list", ListOrdered],
                  ] as const
                ).map(([c, title, Icon]) => (
                  <button
                    key={c}
                    type="button"
                    title={title}
                    className="btn-ghost p-1"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor.current?.focus();
                      document.execCommand(c);
                      commitEdit();
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
                <select value={fontName} onChange={(e) => applyFontName(e.target.value)} onMouseDown={(e) => e.stopPropagation()} className="ml-2 h-6 rounded border border-line bg-white px-1 text-xs" title="Font">
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select value={fontSize} onChange={(e) => applyFontSize(e.target.value)} className="h-6 rounded border border-line bg-white px-1 text-xs" title="Size (pt)">
                  {SIZES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <span className="ml-auto text-[11px] text-muted">Calibri 11 unless you change it here</span>
              </div>
              <div
                ref={editor}
                contentEditable
                suppressContentEditableWarning
                onBlur={commitEdit}
                onInput={commitEdit}
                onKeyUp={readCaretFont}
                onMouseUp={readCaretFont}
                className="min-h-[420px] p-4 text-[11pt] outline-none [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-[10pt] [&_p]:mt-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-[10pt] [&_li]:mb-0 [&_li_p]:m-0"
                style={{ fontFamily: "Calibri, Arial, sans-serif" }}
              />
            </div>
            {rendering && <div className="mt-1 text-xs text-muted">Rendering…</div>}
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="text-sm text-muted">
          {note ?? `${itemsToSend().length} ${followup ? "follow-up" : "email"}${itemsToSend().length === 1 ? "" : "s"} ready. Each firm gets the General ${followup ? "follow-up as a reply all on its deal email" : "email with its person's name"}, the ${chosenFiles.size} attachment${chosenFiles.size === 1 ? "" : "s"} ticked above and your signature.`}
          {countdown != null && launching && <span className="ml-2 tabular-nums text-ink">next in {countdown}s</span>}
        </div>
        <div className="flex items-center gap-2">
          {!launching && Object.values(results).some((r) => !r.ok && !r.pending) && (
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await retryFailedAction(dealId, mode);
                  if (!r.ok) return setNote(r.reason);
                  applyStatus(r.status);
                  if (r.status.queued > 0) setLaunching(true);
                })
              }
            >
              Retry failed ({Object.values(results).filter((r) => !r.ok && !r.pending).length})
            </button>
          )}
          <button type="button" className="btn-secondary" disabled={pending || !shown?.html} onClick={previewToMe} title={cur ? "Emails you the exact message this firm would get" : "Emails you the General email, with no name in the greeting"}>
            Send preview email to me
          </button>
          <button type="button" className="btn-primary px-5" disabled={pending || launching} onClick={launch}>
            {pending ? "Working…" : launching ? "Sending…" : armed && Date.now() - armed <= 10_000 ? (followup ? "SEND FOLLOW-UPS: click again" : "LAUNCH: click again to send") : followup ? "SEND FOLLOW-UPS" : "LAUNCH"}
          </button>
        </div>
      </div>
    </div>
  );
}
