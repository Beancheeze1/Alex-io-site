// app/quote/QuotePrintClient.tsx
//
// Customer-facing printable quote view.
//
// - Reads quote_no from the URL
// - Calls /api/quote/print to fetch full quote + layout data
// - Renders:
//     • Header (quote info + Print / Forward to sales / Schedule a call)
//     • Specs card (from primary foam line)
//     • Pricing card
//     • Layout & next steps card
//     • Line items table
//     • Foam layout preview (inline SVG)
//     • Suggested shipping cartons card (RSC + mailers)
//         - Uses /api/boxes/suggest?quote_no=...&style=both
//         - “Add this carton to my quote” → POST /api/boxes/add-to-quote
//         - Uses primary foam line qty
//         - On success shows a green “Requested” pill for that SKU
//
// Path A safe: standalone client component, no breaking changes to other routes.

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type QuotePrintState = {
  loading: boolean;
  error: string | null;
  data: any | null;
};

type BoxSuggestion = {
  id: number;
  box_id?: number; // if API returns box_id separately
  sku?: string;
  style?: string; // "RSC" | "Mailer" | etc.
  vendor?: string;
  description?: string;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  length?: number;
  width?: number;
  height?: number;
};

type BoxesSuggestResponse = {
  ok: boolean;
  error?: string;
  rsc?: BoxSuggestion[];
  mailer?: BoxSuggestion[];
  both?: BoxSuggestion[];
};

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

// ----- helpers -----

function getPrimaryLine(printData: any | null): any | null {
  if (!printData) return null;
  if (printData.primary_line_item) return printData.primary_line_item;

  const items: any[] | undefined = printData.line_items;
  if (Array.isArray(items) && items.length > 0) {
    const foamLike =
      items.find((li) => li.is_foam || li.is_primary || li.kind === "foam") ?? items[0];
    return foamLike ?? null;
  }

  return null;
}

function getLineQty(line: any | null): number {
  if (!line) return 1;
  const raw = line.qty ?? line.quantity ?? 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function formatInches(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${n.toFixed(2).replace(/\.00$/, "")} in`;
}

function formatMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `$${n.toFixed(2)}`;
}

function buildForwardToSalesMailto(quoteData: any, quoteNo: string | null): string {
  const quote = quoteData?.quote ?? quoteData;
  const primary = getPrimaryLine(quoteData);
  const qty = getLineQty(primary);

  const customerName =
    quote?.customer_name || quote?.customer || quote?.contact_name || "Customer";
  const emailTo = quoteData?.sales_email || quoteData?.owner_email || "sales@alex-io.com";

  const length =
    primary?.length_in ??
    primary?.length ??
    quoteData?.layout_json?.block?.length_in ??
    quoteData?.layout_json?.block?.length;
  const width =
    primary?.width_in ??
    primary?.width ??
    quoteData?.layout_json?.block?.width_in ??
    quoteData?.layout_json?.block?.width;
  const height =
    primary?.height_in ??
    primary?.height ??
    quoteData?.layout_json?.block?.height_in ??
    quoteData?.layout_json?.block?.height;

  const material = primary?.material_name || primary?.material || quote?.material_name;

  const subjectParts = [
    quoteNo ? `Quote ${quoteNo}` : "New foam quote",
    customerName ? `– ${customerName}` : "",
  ].filter(Boolean);
  const subject = encodeURIComponent(subjectParts.join(" "));

  const specsLines = [
    quoteNo ? `Quote #: ${quoteNo}` : "",
    customerName ? `Customer: ${customerName}` : "",
    qty ? `Qty: ${qty}` : "",
    length && width && height
      ? `Foam block: ${formatInches(length)} × ${formatInches(width)} × ${formatInches(height)}`
      : "",
    material ? `Material: ${material}` : "",
  ].filter(Boolean);

  const quoteUrl =
    BASE_URL && quoteNo
      ? `${BASE_URL.replace(/\/$/, "")}/quote?quote_no=${encodeURIComponent(quoteNo)}`
      : "";

  const bodyLines: string[] = [
    "Please review this quote from the Alex-IO bot.",
    "",
    ...specsLines,
  ];

  if (quoteUrl) {
    bodyLines.push("", `Quote viewer: ${quoteUrl}`);
  }

  bodyLines.push("", "Thanks!");

  const body = encodeURIComponent(bodyLines.join("\n"));
  return `mailto:${encodeURIComponent(emailTo)}?subject=${subject}&body=${body}`;
}

// ----- main component -----

export default function QuotePrintClient() {
  const searchParams = useSearchParams();
  const quoteNo = searchParams.get("quote_no");

  const [state, setState] = useState<QuotePrintState>({
    loading: true,
    error: null,
    data: null,
  });

  const [boxesState, setBoxesState] = useState<{
    loading: boolean;
    error: string | null;
    suggestions: BoxesSuggestResponse | null;
  }>({
    loading: false,
    error: null,
    suggestions: null,
  });

  // box_id (number) -> requested (true)
  const [requestedBoxIds, setRequestedBoxIds] = useState<Set<number>>(new Set());
  const [addingBoxIds, setAddingBoxIds] = useState<Set<number>>(new Set());

  // ----- load quote print data -----

  useEffect(() => {
    if (!quoteNo) {
      setState({ loading: false, error: "Missing quote_no in URL.", data: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(`/api/quote/print?quote_no=${encodeURIComponent(quoteNo)}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          if (cancelled) return;
          setState({
            loading: false,
            error: `Error loading quote: ${res.status} ${res.statusText} ${txt}`.trim(),
            data: null,
          });
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (!json || json.ok === false) {
          setState({
            loading: false,
            error: json?.error || "Failed to load quote.",
            data: null,
          });
          return;
        }

        const data = json.data ?? json;

        // Initialize requested box ids if quote_box_selections are present
        const selections: any[] = data.quote_box_selections || data.box_selections || [];
        const initialRequested = new Set<number>();
        for (const sel of selections) {
          const bid = Number(sel.box_id ?? sel.id);
          if (Number.isFinite(bid)) initialRequested.add(bid);
        }

        setRequestedBoxIds(initialRequested);
        setState({ loading: false, error: null, data });
      } catch (err: any) {
        if (cancelled) return;
        setState({
          loading: false,
          error: `Error loading quote: ${String(err?.message ?? err)}`,
          data: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quoteNo]);

  // ----- load suggested cartons -----

  useEffect(() => {
    if (!quoteNo) return;

    let cancelled = false;

    setBoxesState({ loading: true, error: null, suggestions: null });

    (async () => {
      try {
        const res = await fetch(
          `/api/boxes/suggest?quote_no=${encodeURIComponent(quoteNo)}&style=both`,
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          if (cancelled) return;
          setBoxesState({
            loading: false,
            error: `Error loading carton suggestions: ${res.status} ${res.statusText} ${txt}`.trim(),
            suggestions: null,
          });
          return;
        }
        const json = (await res.json()) as BoxesSuggestResponse;
        if (cancelled) return;
        if (!json || json.ok === false) {
          setBoxesState({
            loading: false,
            error: json?.error || "Failed to load carton suggestions.",
            suggestions: null,
          });
          return;
        }
        setBoxesState({ loading: false, error: null, suggestions: json });
      } catch (err: any) {
        if (cancelled) return;
        setBoxesState({
          loading: false,
          error: `Error loading carton suggestions: ${String(err?.message ?? err)}`,
          suggestions: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quoteNo]);

  const primaryLine = useMemo(() => getPrimaryLine(state.data), [state.data]);
  const primaryQty = useMemo(() => getLineQty(primaryLine), [primaryLine]);

  const rscSuggestions: BoxSuggestion[] =
    (boxesState.suggestions?.rsc as BoxSuggestion[]) || [];
  const mailerSuggestions: BoxSuggestion[] =
    (boxesState.suggestions?.mailer as BoxSuggestion[]) || [];

  const hasSuggestions =
    (rscSuggestions && rscSuggestions.length > 0) ||
    (mailerSuggestions && mailerSuggestions.length > 0);

  const handleAddBoxToQuote = async (box: BoxSuggestion) => {
    if (!quoteNo) return;

    const rawId = box.box_id ?? box.id;
    const boxId = Number(rawId);
    if (!Number.isFinite(boxId)) return;

    // avoid double-clicks
    setAddingBoxIds((prev) => {
      const next = new Set(prev);
      next.add(boxId);
      return next;
    });

    try {
      const res = await fetch("/api/boxes/add-to-quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quote_no: quoteNo,
          box_id: boxId,
          qty: primaryQty,
        }),
      });

      if (!res.ok) {
        // best-effort: show alert, but don't crash the page
        const txt = await res.text().catch(() => "");
        alert(
          `Error adding carton to quote: ${res.status} ${res.statusText}${
            txt ? `\n\n${txt}` : ""
          }`.trim(),
        );
        return;
      }

      const json = await res.json().catch(() => null);
      if (json && json.ok === false) {
        alert(`Error adding carton to quote: ${json.error || "Unknown error."}`);
        return;
      }

      // mark as requested
      setRequestedBoxIds((prev) => {
        const next = new Set(prev);
        next.add(boxId);
        return next;
      });
    } catch (err: any) {
      alert(`Error adding carton to quote: ${String(err?.message ?? err)}`);
    } finally {
      setAddingBoxIds((prev) => {
        const next = new Set(prev);
        next.delete(boxId);
        return next;
      });
    }
  };

  const quote = state.data?.quote ?? state.data;
  const lineItems: any[] = Array.isArray(state.data?.line_items)
    ? state.data.line_items
    : state.data?.line_items || [];

  const layoutSvg: string | null =
    state.data?.layout_svg || state.data?.layout?.svg || null;

  const layoutNotes: string | null =
    state.data?.layout_notes || state.data?.layout?.notes || null;

  // basic derived fields for header/specs
  const customerName =
    quote?.customer_name || quote?.customer || quote?.contact_name || "";
  const status = quote?.status || quote?.quote_status || "";
  const createdAt =
    quote?.created_at || quote?.createdAt || quote?.created || quote?.date;

  const length =
    primaryLine?.length_in ??
    primaryLine?.length ??
    state.data?.layout_json?.block?.length_in ??
    state.data?.layout_json?.block?.length;
  const width =
    primaryLine?.width_in ??
    primaryLine?.width ??
    state.data?.layout_json?.block?.width_in ??
    state.data?.layout_json?.block?.width;
  const height =
    primaryLine?.height_in ??
    primaryLine?.height ??
    state.data?.layout_json?.block?.height_in ??
    state.data?.layout_json?.block?.height;

  const material =
    primaryLine?.material_name ||
    primaryLine?.material ||
    quote?.material_name ||
    quote?.material;

  const unitPrice = primaryLine?.unit_price ?? primaryLine?.unitPrice;
  const extendedPrice =
    primaryLine?.extended_price ??
    primaryLine?.extendedPrice ??
    primaryLine?.total;

  const subtotal = state.data?.summary?.subtotal ?? quote?.subtotal;
  const total = state.data?.summary?.total ?? quote?.total;

  const forwardMailtoHref = useMemo(
    () => buildForwardToSalesMailto(state.data, quoteNo),
    [state.data, quoteNo],
  );

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-500">
            {quoteNo ? `Quote ${quoteNo}` : "Quote"}
          </div>
          {customerName && (
            <div className="text-lg font-semibold text-gray-900">{customerName}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-600">
            {status && (
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 font-medium text-blue-700">
                Status: {status}
              </span>
            )}
            {createdAt && (
              <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5">
                Created: {String(createdAt).slice(0, 10)}
              </span>
            )}
            {primaryQty && (
              <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5">
                Qty: {primaryQty}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Print
          </button>
          <a
            href={forwardMailtoHref}
            className="inline-flex items-center justify-center rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50"
          >
            Forward to sales
          </a>
          {/* You can wire this to Calendly or your scheduler */}
          <a
            href="#schedule"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Schedule a call
          </a>
        </div>
      </div>

      {/* Loading / error */}
      {state.loading && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
          Loading quote…
        </div>
      )}
      {state.error && !state.loading && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {state.error}
        </div>
      )}
      {!state.loading && !state.error && !state.data && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          No quote data found.
        </div>
      )}

      {/* Main grid */}
      {state.data && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Left column: Specs + Pricing */}
          <div className="space-y-4 lg:col-span-1">
            {/* Specs */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-gray-700">Specs</div>
              <dl className="space-y-1 text-sm text-gray-800">
                {length && width && height && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Foam block</dt>
                    <dd>
                      {formatInches(length)} × {formatInches(width)} ×{" "}
                      {formatInches(height)}
                    </dd>
                  </div>
                )}
                {material && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Material</dt>
                    <dd>{material}</dd>
                  </div>
                )}
                {primaryQty && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Quantity</dt>
                    <dd>{primaryQty}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Pricing */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-gray-700">Pricing</div>
              <dl className="space-y-1 text-sm text-gray-800">
                {unitPrice != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Unit price</dt>
                    <dd>{formatMoney(unitPrice)}</dd>
                  </div>
                )}
                {extendedPrice != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Line total</dt>
                    <dd>{formatMoney(extendedPrice)}</dd>
                  </div>
                )}
                {subtotal != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Subtotal</dt>
                    <dd>{formatMoney(subtotal)}</dd>
                  </div>
                )}
                {total != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Total</dt>
                    <dd className="font-semibold">{formatMoney(total)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Layout & next steps */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-gray-700">
                Layout &amp; next steps
              </div>
              <div className="text-sm text-gray-700">
                <p>
                  This quote includes a custom foam layout tailored to your parts. Your
                  sales rep will review any changes or carton requests before finalizing
                  your order.
                </p>
                {layoutNotes && (
                  <p className="mt-2 whitespace-pre-wrap text-gray-800">
                    {layoutNotes}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Line items + Foam layout + Suggested cartons */}
          <div className="space-y-4 lg:col-span-2">
            {/* Line items */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-gray-700">
                Line items
              </div>
              {lineItems && lineItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="border-b bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-2 py-1 font-medium">Item</th>
                        <th className="px-2 py-1 font-medium">Description</th>
                        <th className="px-2 py-1 font-medium text-right">Qty</th>
                        <th className="px-2 py-1 font-medium text-right">Unit</th>
                        <th className="px-2 py-1 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lineItems.map((li: any, idx: number) => (
                        <tr key={li.id ?? idx}>
                          <td className="px-2 py-1">
                            {li.item_no || li.item || li.sku || `Line ${idx + 1}`}
                          </td>
                          <td className="px-2 py-1">
                            {li.description || li.desc || li.notes || ""}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {li.qty ?? li.quantity ?? ""}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {li.unit_price != null || li.unitPrice != null
                              ? formatMoney(li.unit_price ?? li.unitPrice)
                              : ""}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {li.extended_price != null ||
                            li.extendedPrice != null ||
                            li.total != null
                              ? formatMoney(
                                  li.extended_price ?? li.extendedPrice ?? li.total,
                                )
                              : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-500">No line items found.</div>
              )}
            </div>

            {/* Foam layout preview */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700">Foam layout</div>
              </div>
              {layoutSvg ? (
                <div className="overflow-auto rounded-md border bg-gray-50 p-3">
                  <div
                    className="inline-block"
                    dangerouslySetInnerHTML={{ __html: layoutSvg }}
                  />
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  Layout preview not available for this quote.
                </div>
              )}
            </div>

            {/* Suggested shipping cartons */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-1 text-sm font-semibold text-gray-700">
                Suggested shipping cartons
              </div>

              <p className="mb-3 text-xs text-gray-600">
                Based on your foam block size, we&apos;ve suggested common corrugated
                cartons that should fit your parts with a small clearance.
              </p>

              {boxesState.loading && (
                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
                  Looking up carton suggestions…
                </div>
              )}
              {boxesState.error && !boxesState.loading && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {boxesState.error}
                </div>
              )}

              {!boxesState.loading && !boxesState.error && !hasSuggestions && (
                <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                  No carton suggestions were found for this quote. Your sales rep can
                  still help select the best box for shipping.
                </div>
              )}

              {hasSuggestions && (
                <div className="space-y-3">
                  {rscSuggestions.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        RSC cartons (cost-effective)
                      </div>
                      <div className="space-y-2">
                        {rscSuggestions.map((box) => {
                          const rawId = box.box_id ?? box.id;
                          const boxId = Number(rawId);
                          const isRequested =
                            Number.isFinite(boxId) &&
                            requestedBoxIds.has(boxId as number);
                          const isAdding =
                            Number.isFinite(boxId) &&
                            addingBoxIds.has(boxId as number);

                          const sku =
                            box.sku ||
                            (typeof box.id === "string" ? box.id : undefined) ||
                            "";
                          const style = box.style || "RSC";
                          const vendor = box.vendor || "Box Partners";

                          const len = box.length_in ?? box.length;
                          const wid = box.width_in ?? box.width;
                          const ht = box.height_in ?? box.height;

                          return (
                            <div
                              key={`${style}-${boxId}-${sku}`}
                              className="flex items-start justify-between rounded-md border bg-gray-50 p-2 text-xs text-gray-800"
                            >
                              <div>
                                <div className="font-semibold">
                                  {sku || "Carton"}{" "}
                                  <span className="ml-1 inline-flex rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                    {style}
                                  </span>
                                </div>
                                <div className="text-gray-600">
                                  {len && wid && ht ? (
                                    <>
                                      {formatInches(len)} × {formatInches(wid)} ×{" "}
                                      {formatInches(ht)}
                                    </>
                                  ) : (
                                    "Dimensions not available"
                                  )}
                                </div>
                                <div className="text-gray-500">
                                  {vendor}
                                  {box.description ? ` – ${box.description}` : ""}
                                </div>
                              </div>
                              <div className="ml-3 shrink-0">
                                {isRequested ? (
                                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700">
                                    Requested
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleAddBoxToQuote(box)}
                                    disabled={isAdding}
                                    className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isAdding
                                      ? "Adding…"
                                      : "Add this carton to my quote"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {mailerSuggestions.length > 0 && (
                    <div>
                      <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Mailer cartons (presentation-focused)
                      </div>
                      <div className="space-y-2">
                        {mailerSuggestions.map((box) => {
                          const rawId = box.box_id ?? box.id;
                          const boxId = Number(rawId);
                          const isRequested =
                            Number.isFinite(boxId) &&
                            requestedBoxIds.has(boxId as number);
                          const isAdding =
                            Number.isFinite(boxId) &&
                            addingBoxIds.has(boxId as number);

                          const sku =
                            box.sku ||
                            (typeof box.id === "string" ? box.id : undefined) ||
                            "";
                          const style = box.style || "Mailer";
                          const vendor = box.vendor || "Box Partners";

                          const len = box.length_in ?? box.length;
                          const wid = box.width_in ?? box.width;
                          const ht = box.height_in ?? box.height;

                          return (
                            <div
                              key={`${style}-${boxId}-${sku}`}
                              className="flex items-start justify-between rounded-md border bg-gray-50 p-2 text-xs text-gray-800"
                            >
                              <div>
                                <div className="font-semibold">
                                  {sku || "Mailer"}{" "}
                                  <span className="ml-1 inline-flex rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                                    {style}
                                  </span>
                                </div>
                                <div className="text-gray-600">
                                  {len && wid && ht ? (
                                    <>
                                      {formatInches(len)} × {formatInches(wid)} ×{" "}
                                      {formatInches(ht)}
                                    </>
                                  ) : (
                                    "Dimensions not available"
                                  )}
                                </div>
                                <div className="text-gray-500">
                                  {vendor}
                                  {box.description ? ` – ${box.description}` : ""}
                                </div>
                              </div>
                              <div className="ml-3 shrink-0">
                                {isRequested ? (
                                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700">
                                    Requested
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleAddBoxToQuote(box)}
                                    disabled={isAdding}
                                    className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isAdding
                                      ? "Adding…"
                                      : "Add this carton to my quote"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Customer-facing note under suggestions (Enhancement C copy-only, no logic) */}
              <p className="mt-3 text-[11px] text-gray-500">
                Any cartons you mark as <span className="font-semibold">Requested</span>{" "}
                will be reviewed and confirmed by your sales rep before finalizing your
                order.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
