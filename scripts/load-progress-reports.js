// One-off: load the four Word progress reports (Downloads, Sep 2026) into the CRM trackers.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const Y = 2026, MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const d = (s) => { const m = (s || "").match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})/g); if (!m) return null; const last = m[m.length-1].split(" "); return new Date(Date.UTC(Y, MON[last[0]], +last[1], 16)); };
// name in report -> existing company name in CRM (exact), or {create, roles, domain}
const MAP = {
  "BIG Equity":"BIG Equity","Abod Capital":"Abod Capital","Hamilton Lane":"Hamilton Lane","JDI":"jdi-realty","UFUND":"Ufund Investment","Nelnet":"Nelnet","MLG Capital":"MLG Capital",
  "Corebridge":{create:"Corebridge Financial",roles:["Investor"],domain:"corebridgefinancial.com"},"Humphreys Capital":"Humphreys Capital","Calibogue Capital":"Calibogue Capital","Midloch":"Midloch LLC","Wellings Capital":"Wellings Capital",
  "Silvercap Partners":"SilverCap Partners","SilverCap":"SilverCap Partners","American Realty Advisors":"American Realty Advisors","Slate Asset Management":"Slate Asset Management","Prospect Ridge":"Prospect Ridge","Blue Vista":"Blue Vista",
  "MileRock":{create:"MileRock",roles:["Investor"],domain:"milerock.com"},"Grosvenor":"Grosvenor","Belay Investment Group":"Belay Investment Group LLC","Brush Street":{create:"Brush Street Investments",roles:["Investor"],domain:"brushstreet.com"},
  "Long Wharf":"Long Wharf Capital LLC","DRA Advisors":"DRA Advisors LLC","Wafra":"Wafra","Artemis":"Artemis Real Estate Partners","Trigate Capital":"TriGate Capital","Invesco":"Invesco",
  "Alex Brown":"Alex. Brown Realty,","Alidade":"Alidade Capital","KCB":"kcb-partners.com","Devli Real Estate":"Devli Real Estate","Titan Development":"Titan Development","ReCap":"ReCap - RGA (Reinsurance Group of America)",
  "Clairmont Capital":"Clairmont Capital Group","Raith":"Raith Capital Partners","Brasa":"Brasa Capital Management","Twin Focus":"Twin Focus Realty","Mandrake":"Mandrake Capital Partners, LLC","PeakRock":"PeakRock","Drake":"Drake Real Estate Partners",
  "Centersquare":"CenterSquare Investment Management LLC","First Industrial":"First Industrial Realty Trust",
  "Dimension Development Partners":"Dimensions Development Partners","Red Cedar Partners":"Red Cedar Partners","Brookline Real Estate":"Brookline Real Estate","Corta":"cortadev.com","SPS":{create:"SPS",roles:["Sponsor"]},
  "W Companies":"W Companies","Wright Partners":"Wright Partners","Core Acquisitions":"Core Acquisitions","P9 Development":{create:"P9 Development",roles:["Sponsor"]},"Broadstreet":"Broadstreet Partners","Sierra Capital Club":"Sierra Capital Club",
  "Onyx Partners":"Onyx Partners ltd","TCII":"TCII Capital","Canopy 5":"Canopy 5","Bradford Real Estate - Chicago":"Bradford Real Estate Services","Cole Valley Partners":"Cole Valley Partners","Bluecurrent":{create:"Bluecurrent",roles:["Sponsor"]},
  "LRG Investors":"LRG Investors","Boos Development":"boosdevelopment","Zaremba":"Zaremba Group","Carpionato":"Carpionato Properties Inc","Launch Development":"Launch Development Group","Lokre":"Lokre",
  "Textstone":{create:"Textstone",roles:["Sponsor"]},"RDS":{create:"RDS",roles:["Sponsor"]},"Broadreach Retail":{create:"Broadreach Retail",roles:["Sponsor"]},"Fortec":"Fortec","Gulfstream":"Gulfstream Commercial Services","Tallgrass Capital":"Tallgrass Capital",
  "Citivest Commercial Investments":"Citivest","Tapp Industries":"The Tapp Companies","Tailwinds Development":"Tailwinds Development","Sage Invesco":{create:"Sage Invesco",roles:["Sponsor"]},"Hernandez Development":"Hernandez Construction","Impeccable Capital":"Impeccable Development",
};
const R = (n, s, note = "") => ({ n, s, note });
const REPORTS = [
  { deal: { id: "cmtm00p1e0ya1ujq0n9b7h5bd" }, sponsor: "Citivest", reportDate: d("Sep 3"), preparedFor: "Citivest Commercial Investments",
    themes: ["Argus model requested by multiple groups (Corebridge, MLG Capital)", "Occupancy and asset vintage flagged as a concern (Hamilton Lane)", "JDI Realty seeking clarity on pad sequencing and exit cap before committing further"],
    items: "Argus model in Argus 14.0 format (Corebridge, MLG Capital)",
    rows: [R("BIG Equity", 8, "Passed (Sep 1): shadow-anchored properties aren't a fit for their portfolio, though they're familiar with the market and separately reviewing Everett Mall"),
      R("Abod Capital", 8, "Can't get IC on board with Washington State currently; found the deal interesting (Sep 2)"), R("Hamilton Lane", 8, "Passed; concerns over current occupancy and asset vintage (Sep 1)"),
      R("JDI", 6, "Interested; requested call with sponsor on pad sequencing and exit cap; call proposed, not yet scheduled as of Sep 3"),
      R("UFUND", 6, "Sent Longmont and Tucson. Both opportunities are fairly close to our profile from a check size, asset type, return profile, and timing perspective. The primary issue for us is the current cash flow. At approximately 3.5%–4%, the cash yield is below what our investor base typically requires, particularly during the early years. That said, close enough to our criteria that it would be worthwhile to get a relationship started with Citivest; also interested in discussing whether there is any flexibility in the structure that could improve the current cash yield."),
      R("Nelnet", 4, "Confirmed receipt; reviewing (Sep 2)"), R("MLG Capital", 4, "Reviewing; requested Argus model (Sep 1)"), R("Corebridge", 4, "Familiar with the market (owns multifamily in Everett); reviewing; requested Argus model in 14.0 format (Sep 1)"),
      R("Humphreys Capital", 2, "Awaiting response (Sep 1)"), R("Calibogue Capital", 2, "Awaiting response (Sep 1)"), R("Midloch", 2), R("Wellings Capital", 1)] },
  { deal: { create: { name: "BrightStar Property Group | Kansas City Metro Retail Portfolio (BSPG Recap)", propertyName: "Kansas City Metro Retail Portfolio (BSPG Recap)", sponsorName: "BrightStar Property Group", stage: "Deal Taken To Market", assetClass: "Retail", city: "Kansas City", state: "MO" } },
    sponsor: { create: "BrightStar Property Group", roles: ["Sponsor"] }, reportDate: d("Sep 3"), preparedFor: "BrightStar Property Group (BSPG); Parker Webb and Cory Tuck",
    themes: ["One group flagged the deal as outside their sector mandate, which targets self-storage, industrial, and residential (Blue Vista)", "One group passed on tenant mix and market fit, noting KS/MO isn't a primary target market for them (SilverCap)", "Deal size was flagged as too small by more than one group, including two who'd want a larger check to justify starting a venture (Slate, Prospect Ridge, American Realty Advisors)"],
    items: "", rows: [R("Silvercap Partners", 8, "Passed (Aug 24): tenant mixes don't fit and KS/MO isn't a primary target market for them"),
      R("JDI", 8, "Recaps are generally tough for their portfolio, and they'd want retail to stabilize above 10% cash-on-cash; passed after confirming no fit (Aug 25)"),
      R("MLG Capital", 8, "Passed (Aug 25): assets aren't in the best micro-locations within Johnson County, product is Class B with local-credit tenants, and they'd exit around a 7.75-8.00% cap rate; separately scheduled a call for Aug 31 to discuss what they're targeting in retail more broadly"),
      R("American Realty Advisors", 8, "Passed (Aug 26): total deal size and asset vintage don't meet their criteria"), R("Slate Asset Management", 8, "Passed (Aug 25): too small for them and not one of their target markets"),
      R("Humphreys Capital", 8, "Passed (Aug 26): programmatic isn't something they'd do; they only look at recaps as standalone yield plays or one-off opportunistic deals in the $5-10M range, and this wasn't the right fit"),
      R("Prospect Ridge", 8, "Passed (Aug 25): assets in this portfolio are too small for them to start a venture; open to portfolios at $25mm+ of equity, so asked to keep sending future opportunities"),
      R("Abod Capital", 8, "Passed (Sep 2): MO and KS geographies not a fit"), R("Blue Vista", 7, "\"Retail isn't core to our current investment focus – we continue to exclusively target development and acquisition opportunities across self-storage, industrial, and residential.\""),
      R("Nelnet", 4, "Awaiting response (Aug 24); confirmed receipt and reviewing (Aug 26)"),
      ...["MileRock", "Grosvenor", "Calibogue Capital", "Belay Investment Group", "Brush Street", "Long Wharf", "DRA Advisors", "Wafra", "Trigate Capital"].map((n) => R(n, 2, "Awaiting response (Aug 24)")),
      R("Artemis", 2), R("Invesco", 2), R("Corebridge", 2)] },
  { deal: { id: "cmtm00p290yadujq023eu4wzz" }, sponsor: "MORVAY USA", reportDate: d("Aug 26"), preparedFor: "MORVAY (David Rottenberg)",
    themes: ["Return underwriting fell short of minimum thresholds for one group (Blue Vista)", "Appetite for large-scale spec industrial exposure remains limited near-term for one group (Big Equity)", "Development basis viewed as too rich for one group (SilverCap)", "Lack of pre-leasing or committed demand flagged as a concern for one group (Artemis)"],
    items: "", rows: [R("Blue Vista", 8, "I know the MORVAY team quite well. I've looked at this deal a couple of times in the past, including as recently as last month. We've respectfully passed, as we haven't been able to get the underwriting to meet our minimum return thresholds."),
      R("Alex Brown", 8, "Not doing any development"), R("SilverCap", 8, "Not a fit for us at that basis (Aug 21)"), R("Artemis", 8, "Wouldn't build here without pre-leasing to get comfortable with the demand story; also too small a deal for us (Aug 21)"),
      R("BIG Equity", 7, "The scale is a bit larger than we prefer. The demand drivers in the market seem interesting and I do like the concept of building shallow / mid-bay product – an in-demand yet underserved segment with mostly aging stock. That said, we just don't have a place for 300k+ SF of spec industrial, or really any spec industrial, in the near-term. I suspect that will change in the new year, but right now we'd likely only consider BTS, heavily pre-leased, or cash flowing projects."),
      R("Alidade", 7, "Timing won't work for us right now; between funds and looking to kick off the next vehicle with cash-flowing opportunities (Aug 21)"),
      R("KCB", 4, "Passed on Hamilton NJ and had a call with the sponsor Aug 25 covering this deal; clear preference expressed for Space Coast over NJ. Sponsor sent the updated 10-year model and deck to KCB's team Aug 25; feedback from their investment committee expected within about a week"),
      R("Humphreys Capital", 4, "Interesting play with the shallow-bay/IOS/retail pad mix unlocking different sites; came back with initial questions on the sponsor (Aug 21); sponsor answered follow-up questions on Space Coast development experience and track record (Aug 24)"),
      R("Corebridge", 4, "Forwarded internally to their industrial lead for review; awaiting feedback"),
      ...["Devli Real Estate", "Titan Development", "ReCap", "Clairmont Capital", "Raith", "Brasa", "Twin Focus", "Mandrake", "PeakRock", "Drake", "Centersquare"].map((n) => R(n, 2)), R("First Industrial", 1)] },
  { deal: { create: { name: "Marble Capital | Marble Capital Intros", propertyName: "Marble Capital Intros", sponsorName: "Marble Capital", stage: "Intro To Capital Made" } }, sponsor: "Marble Capital", reportDate: d("Aug 24"), preparedFor: "Yunus Jaffrey", themes: [], items: "", sideRoles: ["Sponsor"],
    rows: [R("Dimension Development Partners", 8), R("Red Cedar Partners", 7, "Intro made (May 28)"), R("Brookline Real Estate", 6, "Intro made (May 28)"), R("Corta", 6, "Intro made (May 29)"), R("SPS", 6, "Intro made (May 27)"), R("W Companies", 6), R("Wright Partners", 6, "Intro made (May 28)"),
      R("Core Acquisitions", 6, "Intro made (May 29)"), R("P9 Development", 6, "Intro made (Jun 2)"), R("Broadstreet", 6, "Intro made (Jun 2)"), R("Sierra Capital Club", 6, "Intro made (May 29)"), R("Onyx Partners", 6, "Intro made (Jun 16); no response logged"),
      R("TCII", 5, "Intro made (Jun 11)"), R("Canopy 5", 5, "Intro made (Jun 15)"), R("Bradford Real Estate - Chicago", 5), R("Cole Valley Partners", 5), R("Bluecurrent", 4), R("LRG Investors", 4),
      R("Boos Development", 3, "Intro made (Jun 16)"), R("Zaremba", 3), R("Carpionato", 3), R("Launch Development", 3),
      ...["Lokre", "Textstone", "RDS", "Broadreach Retail", "Fortec", "Gulfstream", "Tallgrass Capital", "Citivest Commercial Investments"].map((n) => R(n, 2)),
      ...["Tapp Industries", "Tailwinds Development", "Sage Invesco", "Hernandez Development", "Impeccable Capital"].map((n) => R(n, 1))] },
];
async function company(spec, fallbackRoles) {
  if (typeof spec === "string") { const c = await p.company.findFirst({ where: { name: spec } }); if (!c) throw new Error("missing company " + spec); return c; }
  const existing = await p.company.findFirst({ where: { name: spec.create } }); if (existing) return existing;
  return p.company.create({ data: { name: spec.create, roles: JSON.stringify(spec.roles ?? fallbackRoles), domain: spec.domain ?? null } });
}
async function contactFor(co) {
  const c = await p.contact.findFirst({ where: { companyId: co.id }, orderBy: [{ marketingContact: "desc" }, { lastActivityAt: "desc" }, { createdAt: "asc" }] });
  if (c) return c;
  return p.contact.create({ data: { firstName: co.name, lastName: "(firm)", companyId: co.id, roles: co.roles } });
}
(async () => {
  const log = [];
  for (const rep of REPORTS) {
    const sponsorCo = await company(rep.sponsor, ["Sponsor"]);
    const meta = { sponsorCompanyId: sponsorCo.id, trackerPreparedFor: rep.preparedFor, trackerThemes: rep.themes.join("\n"), trackerItemsNote: rep.items || null };
    const deal = rep.deal.id ? await p.deal.update({ where: { id: rep.deal.id }, data: meta }) : await p.deal.create({ data: { ...rep.deal.create, ...meta } });
    let added = 0; const created = [];
    for (const r of rep.rows) {
      const spec = MAP[r.n]; if (!spec) throw new Error("unmapped " + r.n);
      const co = await company(spec, rep.sideRoles ?? ["Investor"]); if (typeof spec !== "string") created.push(co.name);
      const k = await contactFor(co);
      const when = d(r.note) ?? rep.reportDate;
      const data = { status: r.s, note: r.note || null, noteDate: r.note ? when : null, updatedAt: when };
      await p.dealInvestor.upsert({ where: { dealId_contactId: { dealId: deal.id, contactId: k.id } }, create: { dealId: deal.id, contactId: k.id, ...data }, update: data });
      added++;
    }
    log.push(`${deal.propertyName}: ${added} rows (${[...new Set(created)].join(", ") || "no new companies"})`);
  }
  // remove the intake test deal with invented investors
  const test = await p.deal.findUnique({ where: { id: "cmtm1pkeh0001ujzkev3gwzwj" } });
  if (test) { await p.deal.delete({ where: { id: test.id } }); log.push(`deleted test deal: ${test.name}`); }
  console.log(log.join("\n"));
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
