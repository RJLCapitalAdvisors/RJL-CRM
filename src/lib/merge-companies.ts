import { prisma } from "@/lib/db";
import { parseList, toJson } from "@/lib/taxonomy";

/**
 * Two pages for one firm (Torchlight Investors wrote from @torchlight.com and @torchlightinvestors.com, Oct 23, 2026):
 * fold one into the other. Every row that pointed at the folded company (people, emails, calls, tickets it sponsors,
 * criteria proposals, momentum, mention scans) points at the kept one; a person who exists on both (same email) is
 * merged too; blanks on the kept company fill from the folded one; the folded company's email domain becomes an
 * alternate domain of the kept one so mail sync files the next email from either address on the one page.
 */
export async function mergeCompanies(fromId: string, intoId: string, log: (s: string) => void = () => {}) {
  if (fromId === intoId) throw new Error("same company");
  const [from, into] = await Promise.all([prisma.company.findUnique({ where: { id: fromId } }), prisma.company.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new Error("company not found");

  // people: a duplicate (same email) merges into the kept company's person, the rest move over
  const fromContacts = await prisma.contact.findMany({ where: { companyId: fromId }, select: { id: true, email: true } });
  const intoContacts = await prisma.contact.findMany({ where: { companyId: intoId }, select: { id: true, email: true } });
  const intoByEmail = new Map(intoContacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]));
  let moved = 0, mergedPeople = 0;
  for (const c of fromContacts) {
    const twin = c.email ? intoByEmail.get(c.email.toLowerCase()) : null;
    if (twin) {
      await mergeContacts(c.id, twin, log);
      mergedPeople++;
    } else {
      await prisma.contact.update({ where: { id: c.id }, data: { companyId: intoId } });
      moved++;
    }
  }
  log(`people: ${moved} moved, ${mergedPeople} merged`);

  // the firm's criteria: one row per company; the kept one wins, else the folded one's moves over
  const [fromCrit, intoCrit] = await Promise.all([prisma.investorCriteria.findUnique({ where: { companyId: fromId }, select: { id: true } }), prisma.investorCriteria.findUnique({ where: { companyId: intoId }, select: { id: true } })]);
  if (fromCrit && !intoCrit) await prisma.investorCriteria.update({ where: { id: fromCrit.id }, data: { companyId: intoId } });
  else if (fromCrit) await prisma.investorCriteria.delete({ where: { id: fromCrit.id } });

  const re = { where: { companyId: fromId }, data: { companyId: intoId } };
  const counts = {
    deals: (await prisma.deal.updateMany({ where: { sponsorCompanyId: fromId }, data: { sponsorCompanyId: intoId } })).count,
    activities: (await prisma.activity.updateMany(re)).count,
    parties: (await prisma.activityParty.updateMany(re)).count,
    proposals: (await prisma.criteriaProposal.updateMany(re)).count,
    momentum: (await prisma.momentum.updateMany(re)).count,
    mentions: (await prisma.mentionScan.updateMany(re)).count,
  };
  log(`re-pointed ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  // the kept company: blanks fill from the folded one, roles and domains union, notes append
  const alt = new Set(parseList(into.altDomains));
  for (const d of [from.domain, ...parseList(from.altDomains)]) if (d && d !== into.domain) alt.add(d);
  const notes = [into.notes?.trim(), from.notes?.trim()].filter(Boolean).join("\n\n") || null;
  await prisma.company.update({
    where: { id: intoId },
    data: {
      roles: toJson([...parseList(into.roles), ...parseList(from.roles)]),
      altDomains: alt.size ? toJson([...alt]) : into.altDomains,
      domain: into.domain ?? from.domain,
      website: into.website ?? from.website,
      description: into.description ?? from.description,
      phone: into.phone ?? from.phone,
      linkedin: into.linkedin ?? from.linkedin,
      streetAddress: into.streetAddress ?? from.streetAddress,
      city: into.city ?? from.city,
      state: into.state ?? from.state,
      yearFounded: into.yearFounded ?? from.yearFounded,
      hubspotId: into.hubspotId ?? from.hubspotId,
      ownerId: into.ownerId ?? from.ownerId,
      notes,
      lastActivityAt: [into.lastActivityAt, from.lastActivityAt].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    },
  });
  // the folded company's domain must leave before the kept one's alternate list is trusted (one company per domain)
  await prisma.company.update({ where: { id: fromId }, data: { domain: null, hubspotId: null } });
  await prisma.company.delete({ where: { id: fromId } });
  log(`deleted ${from.name} (${fromId}); ${into.name} now also answers to ${[...alt].join(", ") || "no other domain"}`);
  return { moved, mergedPeople, ...counts };
}

/** Two rows for one person: everything on the first moves to the second, blanks fill, the first is deleted. */
export async function mergeContacts(fromId: string, intoId: string, log: (s: string) => void = () => {}) {
  if (fromId === intoId) throw new Error("same contact");
  const [from, into] = await Promise.all([prisma.contact.findUnique({ where: { id: fromId } }), prisma.contact.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new Error("contact not found");

  // progress-report rows: one per deal and person; a deal both are on keeps the kept person's row with the notes joined
  for (const r of await prisma.dealInvestor.findMany({ where: { contactId: fromId } })) {
    const twin = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: r.dealId, contactId: intoId } } });
    if (!twin) {
      await prisma.dealInvestor.update({ where: { id: r.id }, data: { contactId: intoId } });
      continue;
    }
    const extras = new Set([...parseList(twin.extraContactIds), ...parseList(r.extraContactIds)].filter((x) => x !== fromId && x !== intoId));
    await prisma.dealInvestor.update({
      where: { id: twin.id },
      data: {
        status: Math.max(twin.status, r.status),
        note: [twin.note?.trim(), r.note?.trim()].filter(Boolean).join("\n") || null,
        noteDate: [twin.noteDate, r.noteDate].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        extraContactIds: extras.size ? toJson([...extras]) : null,
        openingLine: twin.openingLine ?? r.openingLine,
        bodyOverride: twin.bodyOverride ?? r.bodyOverride,
      },
    });
    await prisma.dealInvestor.delete({ where: { id: r.id } });
  }
  // the folded person listed as an extra recipient on other rows, or on a launch: now the kept one
  for (const r of await prisma.dealInvestor.findMany({ where: { extraContactIds: { contains: fromId } }, select: { id: true, extraContactIds: true } })) {
    await prisma.dealInvestor.update({ where: { id: r.id }, data: { extraContactIds: toJson([...new Set(parseList(r.extraContactIds).map((x) => (x === fromId ? intoId : x)))]) } });
  }
  for (const l of await prisma.dealLaunch.findMany({ where: { toContactIds: { contains: fromId } }, select: { id: true, toContactIds: true } })) {
    await prisma.dealLaunch.update({ where: { id: l.id }, data: { toContactIds: toJson([...new Set(parseList(l.toContactIds).map((x) => (x === fromId ? intoId : x)))]) } });
  }

  // one row per (activity, person) and per (campaign, person): drop the folded one's where the kept one is already there
  for (const p of await prisma.activityParty.findMany({ where: { contactId: fromId }, select: { id: true, activityId: true } })) {
    const dup = await prisma.activityParty.findUnique({ where: { activityId_contactId: { activityId: p.activityId, contactId: intoId } }, select: { id: true } });
    if (dup) await prisma.activityParty.delete({ where: { id: p.id } });
    else await prisma.activityParty.update({ where: { id: p.id }, data: { contactId: intoId } });
  }
  for (const p of await prisma.campaignRecipient.findMany({ where: { contactId: fromId }, select: { id: true, campaignId: true } })) {
    const dup = await prisma.campaignRecipient.findUnique({ where: { campaignId_contactId: { campaignId: p.campaignId, contactId: intoId } }, select: { id: true } });
    if (dup) await prisma.campaignRecipient.delete({ where: { id: p.id } });
    else await prisma.campaignRecipient.update({ where: { id: p.id }, data: { contactId: intoId } });
  }
  const [fromCrit, intoCrit] = await Promise.all([prisma.investorCriteria.findUnique({ where: { contactId: fromId }, select: { id: true } }), prisma.investorCriteria.findUnique({ where: { contactId: intoId }, select: { id: true } })]);
  if (fromCrit && !intoCrit) await prisma.investorCriteria.update({ where: { id: fromCrit.id }, data: { contactId: intoId } });
  else if (fromCrit) await prisma.investorCriteria.delete({ where: { id: fromCrit.id } });

  const re = { where: { contactId: fromId }, data: { contactId: intoId } };
  const counts = {
    activities: (await prisma.activity.updateMany(re)).count,
    proposals: (await prisma.criteriaProposal.updateMany(re)).count,
    momentum: (await prisma.momentum.updateMany(re)).count,
    removals: (await prisma.trackerRemoval.updateMany(re)).count,
  };

  await prisma.contact.update({
    where: { id: intoId },
    data: {
      firstName: into.firstName ?? from.firstName,
      lastName: into.lastName ?? from.lastName,
      email: into.email ?? from.email,
      phone: into.phone ?? from.phone,
      title: into.title ?? from.title,
      linkedin: into.linkedin ?? from.linkedin,
      roles: toJson([...parseList(into.roles), ...parseList(from.roles)]),
      accredited: into.accredited ?? from.accredited,
      streetAddress: into.streetAddress ?? from.streetAddress,
      notes: [into.notes?.trim(), from.notes?.trim()].filter(Boolean).join("\n\n") || null,
      companyId: into.companyId ?? from.companyId,
      ownerId: into.ownerId ?? from.ownerId,
      dealSend: into.dealSend || from.dealSend,
      dealAddress: into.dealAddress || from.dealAddress,
      signoffName: into.signoffName ?? from.signoffName,
      signoffAt: into.signoffAt ?? from.signoffAt,
      marketingContact: into.marketingContact || from.marketingContact,
      unsubscribed: into.unsubscribed || from.unsubscribed,
      departedAt: into.departedAt && from.departedAt ? into.departedAt : null, // one live row means the person is still there
      hubspotId: into.hubspotId ?? from.hubspotId,
      lastActivityAt: [into.lastActivityAt, from.lastActivityAt].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    },
  });
  await prisma.contact.delete({ where: { id: fromId } });
  log(`merged person ${from.email ?? fromId} into ${into.email ?? intoId}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  return counts;
}
