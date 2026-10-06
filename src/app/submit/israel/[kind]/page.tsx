import { notFound } from "next/navigation";
import { IL_REQUIRED, type IlCategory } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";
import { SubmissionForm } from "./form";

export const dynamic = "force-dynamic";

const KINDS: Record<string, { category: IlCategory; title: string; noun: string }> = {
  apartment: { category: "apartments", title: "Submit an apartment", noun: "apartment" },
  house: { category: "houses", title: "Submit a house", noun: "house" },
  project: { category: "projects", title: "Submit a project", noun: "project" },
};

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: KINDS[kind]?.title ?? "Submit" };
}

/**
 * The public submission form (Jonathan, Oct 6, 2026): a developer or broker gets this link, fills in everything on
 * the kind's Required Items List, drops the plan, pictures and documents, and submits. Only a complete submission goes
 * through; it lands in The Que.
 */
export default async function SubmitPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const def = KINDS[kind];
  if (!def) notFound();
  await loadIlRequired();
  const required = IL_REQUIRED[def.category].map((it) => it.label);
  return (
    <div className="min-h-full">
      <header className="bg-[#161b21] text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/israel-logo.svg" alt="RJL Israel" className="h-10 w-auto" />
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight">{def.title}</div>
            <div className="text-xs text-white/70">Fill in every field, add the floorplan and pictures, and submit. We review every submission and come back to you.</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-6">
        <SubmissionForm kind={kind as "apartment" | "house" | "project"} required={required} />
      </main>
      <footer className="mx-auto max-w-3xl px-6 pb-10 text-[11px] text-muted">RJL Israel · what you submit is kept private to our team and the buyers we show it to.</footer>
    </div>
  );
}
