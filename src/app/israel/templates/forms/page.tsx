import { headers } from "next/headers";
import { PageHeader } from "@/components/ui";
import { CopyLink } from "./copy-link";

export const metadata = { title: "Submission forms" };
export const dynamic = "force-dynamic";

const FORMS = [
  { kind: "project", title: "Project submission form", blurb: "A whole building or development: developer, address, units, stories, parking, amenities, delivery, the brochure and renderings." },
  { kind: "apartment", title: "Apartment submission form", blurb: "One unit: the building and project, rooms, floor, direction, mamad, seller type, sizes and mirpasot, machsan, parking, price, the floorplan and pictures." },
  { kind: "house", title: "House submission form", blurb: "A villa, semi-attached or cottage: address, rooms, floors and ceilings, sizes, migrash, pool, parking, price, the floorplan and pictures." },
];

/**
 * Templates > Submission forms (Jonathan, Oct 6, 2026): the three public links to send a developer or broker. Each
 * opens a branded form that asks for everything on that kind's Required Items List, takes the floorplan, pictures and
 * PDFs, and only submits when complete. A submission lands in The Que with the files on it and a note saying who sent it.
 */
export default async function IlSubmissionFormsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "rjl-crm.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;
  return (
    <>
      <PageHeader title="Submission forms" subtitle="Send a developer or broker the link; they fill the form in on a webpage and submit. Only a complete submission goes through, and it lands in The Que." />
      <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
        {FORMS.map((f) => {
          const url = `${base}/submit/israel/${f.kind}`;
          return (
            <div key={f.kind} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold">{f.title}</div>
                  <div className="mt-1 text-sm text-ink-soft">{f.blurb}</div>
                  <a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-sky-700 hover:underline">
                    {url}
                  </a>
                </div>
                <CopyLink url={url} />
              </div>
              <div className="mt-3 text-xs text-muted">The fields follow the {f.kind === "project" ? "Projects" : f.kind === "apartment" ? "Apartments" : "Houses"} Required Items List; edit that list and the form asks for the new line too.</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
