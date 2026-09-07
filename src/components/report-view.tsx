import type { CSSProperties, ReactNode } from "react";
import type { Report } from "@/lib/tracker-report";
import { investorLabel, personLabel, statusOf } from "@/lib/tracker";

/**
 * The progress report, laid out exactly like the Word reports Jonathan sends sponsors:
 * logo, centered Deal Name / Deal Address / Prepared For, blue contact line, Notable Feedback Themes,
 * Items Needed from Sponsor, then a black-bordered Investor | Status | Notes table, gray footer.
 *
 * Styles are inline so the same component renders identically in the app, on the sponsor link,
 * in the standalone HTML export, and when printed to PDF.
 */
export type ReportRow = Report["rows"][number];
export type ReportSlots = {
  statusCell?: (r: ReportRow) => ReactNode;
  noteCell?: (r: ReportRow) => ReactNode;
  rowEnd?: (r: ReportRow) => ReactNode;
  afterRows?: ReactNode;
  showPeople?: boolean;
  /** In-app: replaces the static Themes / Items sections with editable boxes. */
  headerEditor?: ReactNode;
};

const FONT = "Arial, Helvetica, sans-serif";
const S: Record<string, CSSProperties> = {
  page: { fontFamily: FONT, fontSize: "10.5pt", lineHeight: 1.35, color: "#000", background: "#fff", maxWidth: 816, margin: "0 auto", padding: "48px 72px 40px" },
  logo: { height: 50, display: "block", marginBottom: 22 },
  center: { textAlign: "center", margin: "0 0 4px" },
  email: { fontWeight: 700, color: "#1155cc", margin: "14px 0 0" },
  h2: { fontSize: "16pt", fontWeight: 700, margin: "18px 0 6px" },
  ul: { margin: "0 0 4px", paddingLeft: 26 },
  li: { margin: "0 0 2px" },
  rule: { textAlign: "center", color: "#b3b3b3", letterSpacing: 1, margin: "10px 0 2px", overflow: "hidden", whiteSpace: "nowrap" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 16, tableLayout: "fixed" },
  th: { border: "1px solid #000", background: "#f1f3f4", fontWeight: 700, textAlign: "left", padding: "5px 7px", verticalAlign: "top" },
  td: { border: "1px solid #000", padding: "5px 7px", verticalAlign: "top", wordWrap: "break-word" },
  footer: { marginTop: 28, textAlign: "center", color: "#666", fontSize: "9pt" },
  a: { color: "#1155cc", textDecoration: "underline" },
};

const RULE = "_".repeat(50);

export function ReportView({ report, slots = {} }: { report: Report; slots?: ReportSlots }) {
  const { deal, name, rows } = report;
  const address = [deal.propertyAddress, [deal.city, deal.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const themes = (deal.trackerThemes ?? "").split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const items = (deal.trackerItemsNote ?? "").split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const showSections = themes.length > 0 || items.length > 0;
  const cols = slots.rowEnd ? ["31%", "31%", "34%", "4%"] : ["32%", "32%", "36%"];

  return (
    <div className="report" style={S.page}>
      <img src="/logo.png" alt="RJL Capital Advisors" style={S.logo} />
      <p style={S.center}>
        <b>Deal Name:</b> {name}
      </p>
      <p style={S.center}>
        <b>Deal Address:</b> {address || "NA"}
      </p>
      <p style={S.center}>
        <b>Prepared For:</b> {deal.trackerPreparedFor || deal.sponsorName || "—"}
      </p>
      <p style={S.email}>
        Please email{" "}
        <a href="mailto:jonathan@rjlcapadvisors.com" style={S.a}>
          jonathan@rjlcapadvisors.com
        </a>{" "}
        or{" "}
        <a href="mailto:aviel@rjlcapadvisors.com" style={S.a}>
          aviel@rjlcapadvisors.com
        </a>{" "}
        with any questions
      </p>

      {slots.headerEditor}
      {!slots.headerEditor && showSections && (
        <>
          <h2 style={S.h2}>Notable Feedback Themes</h2>
          <ul style={S.ul}>
            {themes.map((t, i) => (
              <li key={i} style={S.li}>
                {t}
              </li>
            ))}
          </ul>
          <div style={S.rule}>{RULE}</div>
          <h2 style={S.h2}>Items Needed from Sponsor</h2>
          <ul style={S.ul}>
            {items.map((t, i) => (
              <li key={i} style={S.li}>
                {t}
              </li>
            ))}
          </ul>
        </>
      )}

      <table style={S.table}>
        <colgroup>
          {cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={S.th}>Investor</th>
            <th style={S.th}>Status</th>
            <th style={S.th}>Notes</th>
            {slots.rowEnd && <th style={{ ...S.th, border: 0, background: "transparent" }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = statusOf(r.status);
            const person = slots.showPeople ? personLabel(r.contact) : "";
            return (
              <tr key={r.id}>
                <td style={S.td}>
                  {investorLabel(r.contact)}
                  {person && person !== investorLabel(r.contact) && <div style={{ fontSize: "8.5pt", color: "#666" }}>{person}</div>}
                </td>
                <td style={{ ...S.td, background: st.bg, color: st.c }}>{slots.statusCell ? slots.statusCell(r) : st.label}</td>
                <td style={S.td}>{slots.noteCell ? slots.noteCell(r) : r.note}</td>
                {slots.rowEnd && <td style={{ ...S.td, border: 0, padding: "5px 0 0 6px", color: "#999" }}>{slots.rowEnd(r)}</td>}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td style={{ ...S.td, color: "#666", textAlign: "center" }} colSpan={3}>
                No investors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {slots.afterRows}

      <div style={S.rule}>{RULE}</div>
      <div style={S.footer}>
        RJL Capital Advisors · 9 Park Place, 3rd Floor, Great Neck, NY 11021 · 516.220.0477
        <br />
        Confidential — For Authorized Recipients Only
      </div>
    </div>
  );
}
