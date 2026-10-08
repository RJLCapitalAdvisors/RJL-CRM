import { prisma } from "@/lib/db";

/**
 * People's names, two problems Jonathan raised on Oct 8, 2026:
 *  1. A mail system's display name "Brown, Tommy" (or "Thompson, CCIM") was being split on spaces, so "Brown," became
 *     the first name. `splitPersonName` reads the display name the way a person does.
 *  2. The name someone goes by is in their sign-off, not in the directory: "Nathaniel Smith" signs "Nate", "Samuel"
 *     signs "Sam". `learnNameFromSignoff` reads the sign-off of an email they wrote and makes that the first name, which
 *     is what every greeting uses. It only accepts a name that plausibly belongs to the same person (same first letter,
 *     a known short form, the two names swapped, or nothing on record yet), so an assistant signing for someone does not
 *     rename them.
 */

const CREDENTIALS = /\b(?:CCIM|MRED|CFA|CPA|MBA|JD|J\.D\.|PE|P\.E\.|AIA|CRE|SIOR|PhD|Ph\.D\.|Esq\.?|MAI|LEED(?: AP)?|CFP|CAIA|FRICS|MRICS|RPA)\b\.?/gi;
const TITLES = /^(?:mr|mrs|ms|miss|dr|prof)\.?$/i;
const CLOSERS = "best|best regards|warm regards|warmest regards|kind regards|kindest regards|regards|rgds|thanks|thank you|many thanks|thanks again|thanks so much|thx|cheers|sincerely|all the best|all my best|talk soon|speak soon|take care|appreciate it|much appreciated|warmly|respectfully|cordially|be well|with thanks|yours|yours truly|best wishes";
const CLOSER_LINE = new RegExp(`^(?:${CLOSERS})\\s*[,!.]*\\s*$`, "i");
const CLOSER_INLINE = new RegExp(`^(?:${CLOSERS})\\s*[,!.]*\\s*[-–—]*\\s*([A-Z][A-Za-z'’.-]{1,24}(?:\\s+[A-Z][A-Za-z'’.-]{1,24}){0,2})\\s*[.!]?$`, "i");
const DASH_NAME = /^[-–—]\s*([A-Z][A-Za-z'’.-]{1,24}(?:\s+[A-Z][A-Za-z'’.-]{1,24}){0,2})\s*$/;
const NOT_A_NAME = /^(?:sent|team|the|from|on|regards|thanks|best|all|sincerely|cheers|office|desk|via|iphone|ipad|outlook|mobile|www|http|mailto|confidential|disclaimer|notice|managing|director|partner|principal|president|ceo|cfo|coo|vp|svp|evp|associate|analyst|founder|received|confirmed|noted|done|ok|okay|agreed|understood|got|will|yes|no|sure|great|perfect|thank|hi|hello|dear|please|see|attached|below|above|re|fw|fwd)$/i;
const COMPANY_WORD = /\b(?:llc|inc|ltd|lp|llp|partners|capital|group|holdings|advisors|management|company|corp|realty|properties|investments|equity|fund|trust|bank|team)\b/i;

/** Short forms and the names behind them, both ways: Nate is Nathaniel, Bill is William, and so on. */
const NICKNAMES: Record<string, string[]> = {
  nathaniel: ["nate", "nat", "nathan"], nathan: ["nate", "nat"], samuel: ["sam", "sammy"], samantha: ["sam", "sammie"], william: ["bill", "will", "billy", "willy", "liam"], robert: ["bob", "rob", "bobby", "robbie", "bert"], richard: ["rick", "rich", "dick", "richie", "ricky"], edward: ["ed", "ted", "eddie", "teddy", "ned"], james: ["jim", "jimmy", "jamie"], charles: ["chuck", "charlie", "chas"], elizabeth: ["liz", "beth", "lizzie", "betsy", "eliza", "liza"], margaret: ["peggy", "meg", "maggie", "marge", "greta"], anthony: ["tony"], joseph: ["joe", "joey"], michael: ["mike", "mick", "mikey"], christopher: ["chris", "kit"], alexander: ["alex", "xander", "sasha"], alexandra: ["alex", "lexi", "sasha", "sandra"], jonathan: ["jon", "jonny"], benjamin: ["ben", "benny", "benji"], daniel: ["dan", "danny"], matthew: ["matt", "matty"], andrew: ["andy", "drew"], thomas: ["tom", "tommy"], peter: ["pete"], patrick: ["pat", "paddy"], patricia: ["pat", "patty", "trish", "tricia"], timothy: ["tim", "timmy"], jeffrey: ["jeff"], gregory: ["greg"], kenneth: ["ken", "kenny"], steven: ["steve"], stephen: ["steve"], lawrence: ["larry"], kimberly: ["kim"], jennifer: ["jen", "jenny"], katherine: ["kate", "kathy", "katie", "kat"], catherine: ["cate", "cathy", "kate", "katie"], rebecca: ["becky", "becca"], deborah: ["deb", "debbie"], jacqueline: ["jackie"], victoria: ["vicky", "tori"], susan: ["sue", "susie"], jessica: ["jess"], nicholas: ["nick"], zachary: ["zach", "zack"], theodore: ["ted", "teddy", "theo"], frederick: ["fred", "freddie"], leonard: ["leo", "lenny"], raymond: ["ray"], douglas: ["doug"], donald: ["don", "donny"], ronald: ["ron", "ronnie"], joshua: ["josh"], abraham: ["abe"], isaac: ["ike"], maxwell: ["max"], maximilian: ["max"], harold: ["hal", "harry"], henry: ["hank", "harry"], david: ["dave", "davey"], jacob: ["jake"], john: ["jack", "johnny"], joel: ["joe"], louis: ["lou", "louie"], martin: ["marty"], michelle: ["shelly"], philip: ["phil"], phillip: ["phil"], russell: ["russ"], sidney: ["sid"], solomon: ["sol"], stuart: ["stu"], terrence: ["terry"], vincent: ["vince", "vinny"], walter: ["walt"], albert: ["al", "bert"], alfred: ["al", "alfie"], allan: ["al"], allen: ["al"], arthur: ["art", "artie"], bernard: ["bernie"], bradley: ["brad"], calvin: ["cal"], clifford: ["cliff"], dennis: ["denny"], eugene: ["gene"], francis: ["frank"], franklin: ["frank"], gabriel: ["gabe"], geoffrey: ["geoff"], gerald: ["gerry", "jerry"], herbert: ["herb"], howard: ["howie"], jerome: ["jerry"], joshua2: [], leonardo: ["leo"], manuel: ["manny"], marcus: ["marc"], mitchell: ["mitch"], montgomery: ["monty"], norman: ["norm"], oliver: ["ollie"], reginald: ["reggie"], rodney: ["rod"], roderick: ["rod"], salvatore: ["sal"], sebastian: ["seb"], stanley: ["stan"], tobias: ["toby"], wesley: ["wes"], zachariah: ["zach"], eleanor: ["ellie", "nora"], florence: ["flo"], gabriella: ["gabby"], gwendolyn: ["gwen"], isabella: ["bella", "izzy"], josephine: ["jo", "josie"], judith: ["judy"], kathleen: ["kathy", "kate"], madeline: ["maddie"], natalie: ["nat"], pamela: ["pam"], priscilla: ["cilla"], rosemary: ["rose"], sandra: ["sandy"], stephanie: ["steph"], suzanne: ["sue", "suzy"], valerie: ["val"], veronica: ["ronnie"], virginia: ["ginny"], wilhelmina: ["mina", "billie"], yvonne: ["vonnie"], eli: ["elijah"], elijah: ["eli"], ezekiel: ["zeke"], hezekiah: ["hezzy"], jedidiah: ["jed"], jeremiah: ["jerry"], moses: ["moe"], morris: ["moe"], shimon: ["shimmy"], yaakov: ["jack"], yitzchak: ["isaac", "itzik"], avraham: ["avi"], menachem: ["mendy"], mordechai: ["motti", "moti"], shlomo: ["sol"], chaim: ["hyman"], yehuda: ["yudi"], yosef: ["yossi", "joseph"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "Brown, Tommy" / "Gregg Thompson, CCIM" / "Dr. Sam O'Connor (LGT)" / "SAM BROWN" read like a person reads them. Nulls for an address or nothing usable. */
export function splitPersonName(display: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!display) return { firstName: null, lastName: null };
  let n = display.trim();
  if (!n || n.includes("@")) return { firstName: null, lastName: null };
  n = n.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\[[^\]]*\]\s*/g, " ");
  n = n.split(/\s+[|/]\s+|\s+[-–—]\s+/)[0]; // "Nate Smith | Managing Director"
  n = n.replace(CREDENTIALS, "").replace(/,\s*$/g, "").replace(/\s{2,}/g, " ").trim(); // "Thompson, CCIM" -> "Thompson"
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((x) => x.trim());
    if (first && last) n = `${first} ${last}`;
    else n = n.replace(/,/g, " ").trim();
  }
  const parts = n.split(/\s+/).filter((x) => x && !TITLES.test(x)).map((p) => (p === p.toUpperCase() && p.length > 1 ? p[0] + p.slice(1).toLowerCase() : p));
  if (!parts.length || parts.length > 4 || COMPANY_WORD.test(n)) return { firstName: null, lastName: null };
  return { firstName: parts[0].replace(/[,.;:]+$/, ""), lastName: parts.length > 1 ? parts.slice(1).join(" ").replace(/[,;:]+$/, "") : null };
}

/** The name someone signed an email with: the line after a closer ("Best," / "Thanks,"), or on the closer's own line ("Thanks, Nate"), or "- Nate". The last one in the text wins. */
export function signoffName(text: string | null | undefined): { firstName: string; lastName: string | null } | null {
  if (!text) return null;
  const own = text.split(/\n\s*(?:From:|-----Original Message-----|On .{5,80} wrote:|Sent from my)/i)[0] ?? text;
  const lines = own.split(/\r?\n/).map((l) => l.replace(/​| /g, " ").trim()).filter(Boolean);
  let found: { firstName: string; lastName: string | null } | null = null;
  const accept = (raw: string) => {
    const name = raw.split(/\s*[|,/]\s*/)[0].trim().replace(/[.!]+$/, "");
    const parts = name.split(/\s+/).filter((p) => p && !TITLES.test(p));
    if (!parts.length || parts.length > 3) return null;
    const first = parts[0].replace(/[,.;:]+$/, "");
    if (!/^[A-Za-z][A-Za-z'’.-]{1,24}$/.test(first) || NOT_A_NAME.test(first) || COMPANY_WORD.test(name)) return null;
    const rest = parts.slice(1).join(" ").replace(CREDENTIALS, "").trim();
    const cased = first === first.toUpperCase() ? first[0] + first.slice(1).toLowerCase() : first[0].toUpperCase() + first.slice(1); // "TALIA" signs as Talia
    return { firstName: cased, lastName: rest && !NOT_A_NAME.test(rest) ? rest : null };
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const inline = l.match(CLOSER_INLINE);
    if (inline) { const a = accept(inline[1]); if (a) found = a; continue; }
    if (CLOSER_LINE.test(l) && lines[i + 1]) { const a = accept(lines[i + 1]); if (a) found = a; continue; }
    const dash = l.match(DASH_NAME);
    if (dash && i >= lines.length - 4) { const a = accept(dash[1]); if (a) found = a; }
  }
  return found;
}

/** Does the signed name plausibly belong to the person on record? Same first letter, a known short form, the two names swapped, or nothing on record. */
export function plausibleSignoff(existing: { firstName: string | null; lastName: string | null }, signed: { firstName: string; lastName: string | null }): "same" | "rename" | "swap" | "no" {
  const ef = norm(existing.firstName ?? ""), el = norm(existing.lastName ?? ""), sf = norm(signed.firstName);
  if (!sf) return "no";
  if (ef === sf) return "same";
  // a name written in another alphabet (Hebrew) or one that already carries the name they go by ("Ezriel “Eric”") is left alone
  if ((existing.firstName ?? "").trim() && (!ef || /["“”‘’']/.test(existing.firstName ?? ""))) return "no";
  if (!ef || /,/.test(existing.firstName ?? "") || ef === el) return "rename"; // nothing on record, or a misparse
  if (sf === el && (!signed.lastName || norm(signed.lastName) === ef)) return "swap"; // "Brown, Tommy" became first Brown, last Tommy
  if (ef[0] === sf[0] && (ef.startsWith(sf) || sf.startsWith(ef) || (NICKNAMES[ef] ?? []).includes(sf) || (NICKNAMES[sf] ?? []).includes(ef))) return "rename";
  if ((NICKNAMES[ef] ?? []).includes(sf) || (NICKNAMES[sf] ?? []).includes(ef)) return "rename"; // Bill for William, Jack for John
  return "no";
}

/** Read the sign-off of something this person wrote and make it their first name (the one greetings use). Returns what changed. */
export async function learnNameFromSignoff(contactId: string, text: string | null | undefined): Promise<{ changed: boolean; from?: string | null; to?: string } > {
  const signed = signoffName(text);
  if (!signed) return { changed: false };
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, signoffName: true } });
  if (!c) return { changed: false };
  const verdict = plausibleSignoff(c, signed);
  const now = new Date();
  if (verdict === "no") return { changed: false };
  if (verdict === "same") {
    if (!c.signoffName) await prisma.contact.update({ where: { id: contactId }, data: { signoffName: signed.firstName, signoffAt: now, ...(!c.lastName && signed.lastName ? { lastName: signed.lastName } : {}) } }).catch(() => null);
    return { changed: false };
  }
  const data = verdict === "swap"
    ? { firstName: signed.firstName, lastName: c.firstName?.replace(/[,.;:]+$/, "") ?? signed.lastName ?? null, signoffName: signed.firstName, signoffAt: now }
    : { firstName: signed.firstName, ...(!c.lastName && signed.lastName ? { lastName: signed.lastName } : {}), signoffName: signed.firstName, signoffAt: now };
  await prisma.contact.update({ where: { id: contactId }, data }).catch(() => null);
  return { changed: true, from: c.firstName, to: signed.firstName };
}
