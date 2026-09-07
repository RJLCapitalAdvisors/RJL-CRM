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
