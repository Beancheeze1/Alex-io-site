// app/admin/quotes/[quote_no]/ticket/page.tsx
//
// Step 33: the printable job ticket for a released quote
// (GET /api/admin/quotes/ticket). Print, PDF download, and a flat blank DXF
// per custom RSC / HSC / FOL box line (GET /api/admin/quotes/box-dxf).
// No prices: this is the floor copy.

"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { dimsText, ticketDate, type JobTicket } from "@/app/lib/job-ticket-core";
import { formatInches } from "@/lib/corrugated-blank";

const inch = (n: number) => `${formatInches(n)}"`;

export default function JobTicketPage() {
  const params = useParams<{ quote_no: string }>();
  const quoteNo = decodeURIComponent(String(params?.quote_no || ""));
  const [ticket, setTicket] = React.useState<JobTicket | null>(null);
  const [tz, setTz] = React.useState<string>("America/New_York");
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!quoteNo) return;
    let alive = true;
    fetch(`/api/admin/quotes/ticket?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.ok) setErr(j?.message || `Couldn't load the job ticket (HTTP ${r.status}).`);
        else {
          setTicket(j.ticket as JobTicket);
          if (j.time_zone) setTz(String(j.time_zone));
        }
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  const day = (v: string | null) => ticketDate(v, tz);
  const enc = encodeURIComponent(quoteNo);
  const cell = "border-b border-[var(--border)] px-2 py-1.5 align-top";
  const head = "border-b border-[var(--border-strong)] px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
  const h2 = "mt-5 mb-2 border-b border-[var(--border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]";
  const btn = "rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-[var(--text-primary)]" data-job-ticket>
      <style>{`@media print { body header { display: none !important; } [data-no-print] { display: none !important; } [data-job-ticket] { max-width: none; padding: 0; } }`}</style>

      <div className="mb-4 flex flex-wrap items-center gap-2" data-no-print>
        <Link href={`/admin/quotes/${enc}`} className={btn}>
          Back to quote
        </Link>
        {ticket ? (
          <>
            <button type="button" className={btn} onClick={() => window.print()} data-ticket-print>
              Print
            </button>
            <a className={btn} href={`/api/admin/quotes/ticket?quote_no=${enc}&format=pdf`} data-ticket-pdf>
              Download PDF
            </a>
          </>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-4 text-[var(--attention)]" data-ticket-error>
          {err}
        </div>
      ) : !ticket ? (
        <div className="text-[var(--text-muted)]">Loading…</div>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-semibold text-[var(--text-muted)]">{ticket.shop}</div>
            <div className="text-xs font-semibold tracking-widest text-[var(--text-muted)]">JOB TICKET</div>
          </div>
          <h1 className="mt-1 text-2xl font-bold" data-ticket-title>
            {ticket.quote_no}
            {ticket.revision ? <span className="ml-2 text-base font-semibold text-[var(--text-muted)]">Rev {ticket.revision}</span> : null}
            {ticket.rush ? <span className="ml-3 rounded bg-[var(--attention)] px-2 py-0.5 text-xs font-bold text-white">RUSH</span> : null}
          </h1>

          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <Pair k="Released" v={`${day(ticket.released_at)}${ticket.released_by ? ` by ${ticket.released_by}` : ""}`} />
            <Pair k="Due" v="______________" />
            <Pair k="PO" v={ticket.po || "—"} />
            <Pair k="Lead time" v={ticket.lead_time || "—"} />
            <Pair k="Accepted" v={ticket.accepted ? `${day(ticket.accepted.at)}${ticket.accepted.name ? ` by ${ticket.accepted.name}` : ""}` : "—"} />
            <Pair k="Confirmed" v={ticket.confirmed ? `${day(ticket.confirmed.at)}${ticket.confirmed.by ? ` by ${ticket.confirmed.by}` : ""}` : "—"} />
          </div>

          <h2 className={h2}>Customer and shipping</h2>
          <div className="grid grid-cols-3 gap-4 text-[13px]" data-ticket-ship>
            <Block title="Customer" lines={[ticket.customer.name, ticket.customer.company, ticket.customer.email, ticket.customer.phone]} />
            <Block title="Ship to" lines={[ticket.ship.name, ticket.ship.company, ...ticket.ship.lines]} />
            <Block
              title="Freight"
              lines={[
                ticket.ship.terms_label,
                ticket.ship.account ? `Carrier account ${ticket.ship.account}` : null,
                [
                  ticket.ship.mode ? (ticket.ship.mode === "ltl" ? "LTL" : "Parcel") : null,
                  ticket.ship.pallets ? `${ticket.ship.pallets} pallet${ticket.ship.pallets > 1 ? "s" : ""}` : null,
                  ticket.ship.cartons ? `${ticket.ship.cartons} carton${ticket.ship.cartons > 1 ? "s" : ""}` : null,
                  ticket.ship.weight_lb ? `about ${ticket.ship.weight_lb} lb` : null,
                ]
                  .filter(Boolean)
                  .join(", ") || null,
              ]}
            />
          </div>

          {ticket.foam ? (
            <section data-ticket-foam>
              <h2 className={h2}>
                Foam: {ticket.foam.sets.toLocaleString("en-US")} set{ticket.foam.sets === 1 ? "" : "s"}
              </h2>
              <div className="mb-2 grid grid-cols-2 gap-x-6 text-[13px]">
                <Pair k="Set size" v={`${dimsText({ L: ticket.foam.block.L, W: ticket.foam.block.W, H: ticket.foam.block.H })} in`} />
                <Pair k="Material" v={ticket.foam.material || "—"} />
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={head}>Layer</th>
                    <th className={head}>Material</th>
                    <th className={head}>Thick</th>
                    <th className={head}>Cavities</th>
                    <th className={head}>Cut file (.dxf / .step)</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.foam.layers.map((l) => (
                    <tr key={l.n} data-ticket-layer={l.n}>
                      <td className={cell}>
                        {l.n}
                        {l.label ? ` ${l.label}` : ""}
                        {l.loose ? " (loose)" : ""}
                      </td>
                      <td className={cell}>{l.material || "—"}</td>
                      <td className={cell}>{inch(l.thickness_in)}</td>
                      <td className={cell}>{l.cavities}</td>
                      <td className={`${cell} font-mono text-[11px]`}>{l.cut_file}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                Full package: <span className="font-mono">{ticket.foam.package_file}</span> (.dxf / .step / .svg). Download the files from the quote page.
              </div>
            </section>
          ) : null}

          {ticket.boxes.length ? (
            <section data-ticket-boxes>
              <h2 className={h2}>
                Boxes: {ticket.boxes.length} line{ticket.boxes.length === 1 ? "" : "s"}
              </h2>
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={head}>Line</th>
                    <th className={head}>Qty</th>
                    <th className={head}>Box</th>
                    <th className={head}>Inside L x W x D</th>
                    <th className={head}>Board</th>
                    <th className={head}>Print / run</th>
                    <th className={head}>Blank</th>
                    <th className={head} data-no-print>
                      DXF
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.boxes.map((b) => (
                    <tr key={b.id} data-ticket-box={b.line}>
                      <td className={cell}>{b.line}</td>
                      <td className={cell}>{b.qty.toLocaleString("en-US")}</td>
                      <td className={cell}>
                        {b.style_label}
                        {b.sku ? <div className="text-[11px] text-[var(--text-muted)]">{b.sku}</div> : null}
                        {b.cells ? <div className="text-[11px] text-[var(--text-muted)]">{`${b.cells.across} x ${b.cells.down} cells`}</div> : null}
                      </td>
                      <td className={cell}>{b.inside ? dimsText(b.inside) : "—"}</td>
                      <td className={cell}>
                        {[b.grade, b.flute && !(b.grade || "").includes(b.flute) ? `${b.flute} flute` : null].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className={cell}>
                        {b.print}
                        {b.run ? <div className="text-[11px] text-[var(--text-muted)]">{b.run}</div> : null}
                      </td>
                      <td className={cell}>
                        {b.blank ? dimsText({ L: b.blank.length_in, W: b.blank.width_in }) : "—"}
                        {b.blank_from_die_line ? <div className="text-[11px] text-[var(--text-muted)]">from die line</div> : null}
                        {b.sheet && b.sheet.up > 1 ? <div className="text-[11px] text-[var(--text-muted)]">{b.sheet.up} up</div> : null}
                      </td>
                      <td className={cell} data-no-print>
                        {b.dxf ? (
                          <a
                            className="text-[var(--action-primary)] underline"
                            href={`/api/admin/quotes/box-dxf?quote_no=${enc}&line_id=${b.id}`}
                            data-box-dxf={b.line}
                          >
                            Blank DXF
                          </a>
                        ) : (
                          <span className="text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {ticket.proof ? (
            <section data-ticket-proof>
              <h2 className={h2}>Artwork proof</h2>
              <div className={ticket.proof.status === "approved" ? "" : "font-semibold text-[var(--attention)]"}>
                {ticket.proof.status === "approved"
                  ? `Proof v${ticket.proof.version} approved${ticket.proof.approved_by ? ` by ${ticket.proof.approved_by}` : ""}${
                      ticket.proof.approved_at ? ` on ${day(ticket.proof.approved_at)}` : ""
                    }. Print to that version.`
                  : ticket.proof.status === "none"
                    ? "Printed job: no proof was sent (released without one)."
                    : `Proof v${ticket.proof.version ?? "?"} is ${ticket.proof.status === "changes" ? "waiting on changes" : "not approved yet"} (released anyway).`}
              </div>
            </section>
          ) : null}

          {ticket.customer_notes ? (
            <section>
              <h2 className={h2}>Customer notes</h2>
              <div className="whitespace-pre-wrap text-[13px]">{ticket.customer_notes}</div>
            </section>
          ) : null}

          <h2 className={h2}>Sign-off</h2>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={head}>Step</th>
                <th className={head}>By</th>
                <th className={head}>Date</th>
                <th className={head}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {["Cut", "Converted / glued", "Packed", "QC"].map((s) => (
                <tr key={s}>
                  <td className={`${cell} h-8 w-40`}>{s}</td>
                  <td className={`${cell} w-40`} />
                  <td className={`${cell} w-28`} />
                  <td className={cell} />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Block({ title, lines }: { title: string; lines: (string | null | undefined)[] }) {
  const shown = lines.filter((l): l is string => !!l && !!String(l).trim());
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</div>
      {shown.length ? shown.map((l, i) => <div key={i}>{l}</div>) : <div className="text-[var(--text-faint)]">—</div>}
    </div>
  );
}
