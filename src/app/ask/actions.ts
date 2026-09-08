"use server";

import { currentUser } from "@/lib/current-user";
import { askCrm, type ChatMessage } from "@/lib/ask-crm";

export async function askAction(history: ChatMessage[]) {
  const me = await currentUser();
  try {
    return await askCrm(history, me?.name ?? "the team");
  } catch (e) {
    return { answer: `Something went wrong: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, lookups: [] };
  }
}
