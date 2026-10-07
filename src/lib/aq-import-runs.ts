import { prisma } from "@/lib/db";
import { normalizeTown } from "@/lib/acquisitions";
import { findProperty, runAqImport, type AqImportReport } from "@/lib/aq-import";
import { buildProposal, buildProposalPart, effective, type Override } from "@/lib/aq-import-build";
import { batchesOf, crmContexts, duplicateHints, fallbackReading, readBatch, readSystem, ruleReading, type CrmContext, type Reading } from "@/lib/aq-import-read";
import { parseTerakotta, type ParsedFile, type PropertyGroup } from "@/lib/aq-terakotta";

/**
 * The Import section's runs (Oct 7, 2026). A file becomes an AqImportRun: parsed whole by code, then read by Claude a
 * few batches per request (the page calls step after step and shows progress, so no request runs long), reviewed
 * by Shawn, written a dozen properties per request through runAqImport, and finally checked against the file: every
 * property in the file must be in the CRM, in Junk, or on Waiting on Shawn, and any that is not is named.
 */

export type Context = { crm: Record<string, CrmContext>; hints: Record<string, string[]> };
export type Check = { inFile: number; live: number; junk: number; waiting: number; missing: { address: string; city?: string; why: string }[]; ignoredRows: { row: number; why: string }[] };
export type RunReport = AqImportReport & { check?: Check; errors: string[] };

const PARALLEL_BATCHES = 4;
const IMPORT_CHUNK = 12;

const json = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
export const runGroups = (r: { groups: string }) => json<ParsedFile>(r.groups, { format: "terakotta", rowCount: 0, ignored: [], groups: [] });
export const runDecisions = (r: { decisions: string }) => json<Record<string, Reading>>(r.decisions, {});
export const runOverrides = (r: { overrides: string }) => json<Record<string, Override>>(r.overrides, {});
export const runContext = (r: { context: string | null }) => json<Context>(r.context, { crm: {}, hints: {} });
export const runReport = (r: { report: string | null }) => json<RunReport | null>(r.report, null);

export async function createRun(fileName: string, buf: Buffer, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  const parsed = parseTerakotta(fileName, buf);
  if ("error" in parsed) return parsed;
  if (!parsed.groups.length) return { error: "No properties found in the file (no rows with a street address)." };
  const run = await prisma.aqImportRun.create({
    data: { fileName, createdBy, status: "READING", format: parsed.format, rowCount: parsed.rowCount, ignoredRows: parsed.ignored.length, propertyCount: parsed.groups.length, groups: JSON.stringify(parsed) },
  });
  return { id: run.id };
}

/** Claim the run for one step (two tabs or a reload never run the same step twice); false when another step holds it. */
async function claim(id: string, seconds: number): Promise<boolean> {
  const now = new Date();
  const r = await prisma.aqImportRun.updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + seconds * 1000) } });
  return r.count === 1;
}
const release = (id: string) => prisma.aqImportRun.update({ where: { id }, data: { lockedUntil: null } });

/** One reading step: the CRM context on the first call, then a few Claude batches at once. */
export async function readStep(id: string): Promise<{ done: number; total: number; status: string; busy?: boolean }> {
  if (!(await claim(id, 290))) {
    const r = await prisma.aqImportRun.findUniqueOrThrow({ where: { id }, select: { readDone: true, propertyCount: true, status: true } });
    return { done: r.readDone, total: r.propertyCount, status: r.status, busy: true };
  }
  try {
    return await readStepClaimed(id);
  } finally {
    await release(id);
  }
}

async function readStepClaimed(id: string): Promise<{ done: number; total: number; status: string }> {
  const run = await prisma.aqImportRun.findUniqueOrThrow({ where: { id } });
  const { groups } = runGroups(run);
  if (run.status !== "READING") return { done: run.readDone, total: groups.length, status: run.status };
  let ctx = run.context ? runContext(run) : null;
  if (!ctx) {
    const crm = await crmContexts(groups);
    ctx = { crm, hints: await duplicateHints(groups, crm) };
    await prisma.aqImportRun.update({ where: { id }, data: { context: JSON.stringify(ctx) } });
  }
  const decisions = runDecisions(run);
  const pending = groups.filter((g) => !decisions[g.key]);
  for (const g of pending) {
    const r = ruleReading(g, ctx.crm[g.key] ?? null, ctx.hints[g.key]);
    if (r) decisions[g.key] = r;
  }
  const needClaude = pending.filter((g) => !decisions[g.key]);
  const batches = batchesOf(needClaude).slice(0, PARALLEL_BATCHES);
  const errors: string[] = [];
  if (batches.length) {
    const sys = await readSystem();
    const results = await Promise.all(batches.map((b) => readBatch(b, ctx!.crm, ctx!.hints, sys).catch((e) => (errors.push(String(e instanceof Error ? e.message : e)), null))));
    for (const r of results) if (r) Object.assign(decisions, r);
    // every call failed (no credit, a bad key, the API down): stop here, nothing is guessed, the next step tries again
    if (results.every((r) => r === null)) throw new Error(`Claude could not be reached: ${errors[0]}`);
    // a property a batch that answered left out is read on its own; if that fails too it is held for Shawn, never dropped
    const missed = batches.filter((_, i) => results[i]).flat().filter((g) => !decisions[g.key]);
    for (const g of missed) {
      const again = await readBatch([g], ctx.crm, ctx.hints, sys).catch((e) => (errors.push(String(e instanceof Error ? e.message : e)), {} as Record<string, Reading>));
      decisions[g.key] = again[g.key] ?? fallbackReading();
    }
  }
  const done = groups.filter((g) => decisions[g.key]).length;
  const status = done >= groups.length ? "REVIEW" : "READING";
  await prisma.aqImportRun.update({ where: { id }, data: { decisions: JSON.stringify(decisions), readDone: done, status, error: errors.length ? errors.slice(0, 3).join(" | ").slice(0, 1000) : null } });
  return { done, total: groups.length, status };
}

export async function saveOverride(id: string, key: string, o: Override | null) {
  const run = await prisma.aqImportRun.findUniqueOrThrow({ where: { id } });
  if (run.status !== "REVIEW") throw new Error("This import is no longer open for changes.");
  const all = runOverrides(run);
  if (o) all[key] = o;
  else delete all[key];
  await prisma.aqImportRun.update({ where: { id }, data: { overrides: JSON.stringify(all) } });
}

const emptyReport = (): RunReport => ({ properties: { new: 0, updated: 0, junked: 0, skipped: 0 }, contacts: { new: 0, updated: 0 }, companies: { new: 0, updated: 0 }, numbersJunked: 0, pipeline: [], callbacks: [], notes: 0, transcripts: 0, waiting: [], unsure: [], errors: [] });
function merge(a: RunReport, b: AqImportReport) {
  for (const k of ["new", "updated", "junked", "skipped"] as const) a.properties[k] += b.properties[k];
  for (const k of ["new", "updated"] as const) {
    a.contacts[k] += b.contacts[k];
    a.companies[k] += b.companies[k];
  }
  a.numbersJunked += b.numbersJunked;
  a.notes += b.notes;
  a.transcripts += b.transcripts;
  a.pipeline.push(...b.pipeline);
  a.callbacks.push(...b.callbacks);
  a.waiting.push(...b.waiting);
  a.unsure.push(...b.unsure);
}

/** One import step: the next dozen properties written through runAqImport. `from` guards against a double click. */
export async function importStep(id: string, from: number): Promise<{ done: number; total: number; status: string; busy?: boolean }> {
  if (!(await claim(id, 290))) {
    const r = await prisma.aqImportRun.findUniqueOrThrow({ where: { id }, select: { importDone: true, propertyCount: true, status: true } });
    return { done: r.importDone, total: r.propertyCount, status: r.status, busy: true };
  }
  try {
    return await importStepClaimed(id, from);
  } finally {
    await release(id);
  }
}

async function importStepClaimed(id: string, from: number): Promise<{ done: number; total: number; status: string }> {
  const run = await prisma.aqImportRun.findUniqueOrThrow({ where: { id } });
  const parsed = runGroups(run);
  const total = parsed.groups.length;
  if (run.status === "DONE") return { done: total, total, status: "DONE" };
  if (run.status !== "REVIEW" && run.status !== "IMPORTING") throw new Error("This import is not ready to write yet.");
  if (run.importDone !== from) return { done: run.importDone, total, status: run.status };
  const decisions = runDecisions(run);
  const overrides = runOverrides(run);
  const ctx = runContext(run);
  const report = runReport(run) ?? emptyReport();
  const chunk = parsed.groups.slice(from, from + IMPORT_CHUNK);
  await prisma.aqImportRun.update({ where: { id }, data: { status: "IMPORTING" } });
  try {
    const parts = chunk.map((g) => buildProposalPart(g, effective(decisions[g.key] ?? fallbackReading(), overrides[g.key]), run.fileName, Boolean(ctx.crm[g.key])));
    const res = await runAqImport(buildProposal(parts, run.fileName));
    if (res.report) merge(report, res.report);
  } catch (e) {
    report.errors.push(`Properties ${from + 1} to ${from + chunk.length}: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
  }
  const done = from + chunk.length;
  if (done >= total) {
    report.check = await checkAgainstFile(parsed);
    await prisma.aqImportRun.update({ where: { id }, data: { importDone: done, report: JSON.stringify(report), status: "DONE", importedAt: new Date() } });
    return { done, total, status: "DONE" };
  }
  await prisma.aqImportRun.update({ where: { id }, data: { importDone: done, report: JSON.stringify(report) } });
  return { done, total, status: "IMPORTING" };
}

/** Every property in the file: in the CRM (live), in Junk, or on Waiting on Shawn. Anything else is named. */
export async function checkAgainstFile(parsed: ParsedFile): Promise<Check> {
  const check: Check = { inFile: parsed.groups.length, live: 0, junk: 0, waiting: 0, missing: [], ignoredRows: parsed.ignored };
  const pending = await prisma.aqPendingImport.findMany({ where: { status: "PENDING" }, select: { address: true, city: true, parcelId: true } });
  const isPending = (g: PropertyGroup) => pending.some((p) => (g.facts.parcelId && p.parcelId === g.facts.parcelId) || (p.address.toLowerCase() === g.facts.address.toLowerCase() && normalizeTown(p.city) === normalizeTown(g.facts.city)));
  for (const g of parsed.groups) {
    if (isPending(g)) {
      check.waiting++;
      continue;
    }
    const f = await findProperty(g.facts.address, g.facts.parcelId, g.facts.city);
    if (!f) check.missing.push({ address: g.facts.address, city: g.facts.city, why: "not found in the CRM after the import" });
    else if (f.junkedAt) check.junk++;
    else check.live++;
  }
  return check;
}
