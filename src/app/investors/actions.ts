"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/current-user";
import { createEngagementDraft } from "@/lib/engagement";

/** Engagement mode "Done": draft the letter to the sponsor in the signed-in person's Outlook, listing the ticked groups. */
export async function createEngagementLetter(dealId: string, companyIds: string[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the letter is drafted in your own mailbox." };
  if (!companyIds.length) return { ok: false as const, reason: "Tick at least one group." };
  try {
    const r = await createEngagementDraft(dealId, companyIds, me.email);
    revalidatePath(`/deals/${dealId}`);
    revalidatePath(`/deals/${dealId}/tracker`);
    return r;
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

/** Make list: a blank email in the signed-in person's Outlook that lists the ticked firms, nothing else (Jonathan, Oct 28, 2026). */
export async function createInvestorListDraft(companyIds: string[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the email is drafted in your own mailbox." };
  if (!companyIds.length) return { ok: false as const, reason: "Tick at least one group." };
  try {
    const { createInvestorList } = await import("@/lib/investor-list");
    return await createInvestorList(companyIds, me.email);
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

/** Reach out (Jonathan, Oct 28, 2026): the ticked firms become a reach-out record, and the Send page takes it from there. */
export async function startOutreach(companyIds: string[], audience: "investor" | "sponsor" = "investor") {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) first; the emails go from your own mailbox." };
  const { createOutreach, MAX_OUTREACH } = await import("@/lib/outreach");
  if (!companyIds.length) return { ok: false as const, reason: "Tick at least one group." };
  if (companyIds.length > MAX_OUTREACH) return { ok: false as const, reason: `${MAX_OUTREACH} firms is the most for one reach out.` };
  try {
    const r = await createOutreach(companyIds, audience);
    if (!r.firms) return { ok: false as const, reason: "None of the ticked firms has a person with an email address." };
    revalidatePath(audience === "sponsor" ? "/sponsors" : "/investors");
    return { ok: true as const, id: r.id, firms: r.firms };
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
