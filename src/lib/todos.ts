import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { stripDashes } from "@/lib/style";

/**
 * To-do items from deals@ (Jonathan, Sep 22, 2026). A team member forwards an email to deals@ with a note on top
 * such as "remind me to handle this" or "to do: call him back". That is not a deal: the note is read, the people in
 * the forwarded email are named, and a short item lands on the forwarder's dashboard until they dismiss it.
 */
const REMINDER = /\b(remind me|reminder|to[\s-]?do|todo|follow[\s-]?up (on|with) (this|him|her|them)|handle this|deal with this|don'?t forget|note to self|add to my list)\b/i;

/** The forwarder's own words: everything above the forwarded header. */
export function forwardNote(bodyText: string): string {
  const cut = bodyText.search(/^\s*(From|Sent|-----+ ?Original Message|Begin forwarded message)\s*:?/im);
  return (cut > 0 ? bodyText.slice(0, cut) : bodyText).trim();
}

export function looksLikeReminder(bodyText: string, subject: string | null): boolean {
  const note = forwardNote(bodyText);
  return REMINDER.test(note.slice(0, 600)) || REMINDER.test(subject ?? "");
}

const Out = z.object({
  text: z.string().describe("The to-do as one short line for the forwarder's own list, imperative, naming the person or firm involved, e.g. 'Call Royce Hadden (Corebridge) back about the rent comps he asked for'. Under 30 words. No dashes as punctuation."),
  people: z.array(z.string()).describe("Each person in the forwarded email, as 'Name (Firm)' when the firm is known. Not the forwarder. Empty if nobody is named."),
});

export async function createTodoFromEmail(opts: { userEmail: string; subject: string | null; bodyText: string; messageId: string }): Promise<{ id: string; text: string; people: string[] } | null> {
  const note = forwardNote(opts.bodyText);
  let text = stripDashes(note.replace(/\s+/g, " ").trim()).slice(0, 200) || (opts.subject ?? "Follow up");
  let people: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const res = await client.messages.parse({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system: "A team member at RJL Capital Advisors forwarded an email to the CRM with a note asking to be reminded to handle something. Write the to-do item for their list and name the people in the forwarded email.",
        messages: [{ role: "user", content: `Forwarder's note:\n${note.slice(0, 1500) || "(none, see subject)"}\n\nSubject: ${opts.subject ?? ""}\n\nForwarded email:\n${opts.bodyText.slice(0, 6000)}` }],
        output_config: { format: zodOutputFormat(Out) },
      });
      if (res.parsed_output) {
        text = stripDashes(res.parsed_output.text).trim() || text;
        people = res.parsed_output.people.map((p) => stripDashes(p).trim()).filter(Boolean);
      }
    } catch {
      /* the note itself is the item */
    }
  }
  const row = await prisma.reminder.upsert({ where: { messageId: opts.messageId }, create: { userEmail: opts.userEmail.toLowerCase(), text, people: JSON.stringify(people), subject: opts.subject, messageId: opts.messageId }, update: { text, people: JSON.stringify(people) } });
  return { id: row.id, text, people };
}
