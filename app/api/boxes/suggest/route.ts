// app/api/boxes/suggest/route.ts
//
// Box suggester.
// - POST: simple stubbed suggester used by the layout editor (dims in body)
// - GET: quote-based suggester used by the quote print page
//
// POST /api/boxes/suggest
//   Body:
//     {
//       footprint_length_in: number;
//       footprint_width_in: number;
//       stack_depth_in: number;
//       qty?: number | null;
//     }
//
//   Response (stub):
//     {
//       ok: boolean;
//       bestRsc?: { ... };
//       bestMailer?: { ... };
//       error?: string;
//     }
//
// GET /api/boxes/suggest?quote_no=Q-...&style=both
//   Response (for QuotePrintClient):
//     {
//       ok: true;
//       block: {
//         length_in: number;
//         width_in: number;
//         height_in: number;
//         clearance_in: number;
//         required_inside: { length_in; width_in; height_in };
//       };
//       style_mode: "rsc" | "mailer" | "both" | string;
//       rsc: BoxSuggestion[];
//       mailer: BoxSuggestion[];
//     }
//   or
//     { ok: false; error: string; }

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =======================================================================
   POST: stub suggester for layout editor (unchanged behaviour)
   ======================================================================= */

type BoxSuggestIn = {
  footprint_length_in: number;
  footprint_width_in: number;
  stack_depth_in: number;
  qty?: number | null;
};

type StubBoxRow = {
  sku: string;
  description: string;
  style: "RSC" | "MAILER";
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
};

type SuggestedBox = StubBoxRow & {
  fit_score: number; // 0–100 (higher = tighter but still valid)
  notes?: string;
};

type BoxSuggestOut = {
  ok: boolean;
  bestRsc?: SuggestedBox | null;
  bestMailer?: SuggestedBox | null;
  error?: string;
  message?: string;
};

// Tiny stub catalog (replace with real Box Partners data later).
const CATALOG: StubBoxRow[] = [
  {
    sku: "BP-RSC-12x12x4",
    description: "RSC 12 x 12 x 4",
    style: "RSC",
    inside_length_in: 12,
    inside_width_in: 12,
    inside_height_in: 4,
  },
  {
    sku: "BP-RSC-16x12x6",
    description: "RSC 16 x 12 x 6",
    style: "RSC",
    inside_length_in: 16,
    inside_width_in: 12,
    inside_height_in: 6,
  },
  {
    sku: "BP-RSC-20x16x6",
    description: "RSC 20 x 16 x 6",
    style: "RSC",
    inside_length_in: 20,
    inside_width_in: 16,
    inside_height_in: 6,
  },
  {
    sku: "BP-MLR-13x10x3",
    description: "Tab-lock mailer 13 x 10 x 3",
    style: "MAILER",
    inside_length_in: 13,
    inside_width_in: 10,
    inside_height_in: 3,
  },
  {
    sku: "BP-MLR-15x11x4",
    description: "Tab-lock mailer 15 x 11 x 4",
    style: "MAILER",
    inside_length_in: 15,
    inside_width_in: 11,
    inside_height_in: 4,
  },
];

// Compute a simple fit score based on volume utilization.
// Tries both orientations (L/W swapped). Returns null if it doesn’t fit.
function computeFitScore(
  box: StubBoxRow,
  footprintL: number,
  footprintW: number,
  stackDepth: number,
): number | null {
  const orientations: Array<[number, number]> = [
    [box.inside_length_in, box.inside_width_in],
    [box.inside_width_in, box.inside_length_in],
  ];

  const boxH = box.inside_height_in;
  if (stackDepth <= 0 || footprintL <= 0 || footprintW <= 0) return null;

  let bestScore: number | null = null;

  for (const [boxL, boxW] of orientations) {
    if (footprintL <= boxL && footprintW <= boxW && stackDepth <= boxH) {
      const foamVol = footprintL * footprintW * stackDepth;
      const boxVol = boxL * boxW * boxH;
      if (boxVol <= 0) continue;

      const utilization = foamVol / boxVol; // 0–1
      const score = Math.round(utilization * 100);

      if (bestScore === null || score > bestScore) {
        bestScore = score;
      }
    }
  }

  return bestScore;
}

function describeFit(score: number): string {
  if (score >= 90) return "Tight fit (minimal extra space)";
  if (score >= 75) return "Comfortable fit";
  if (score >= 55) return "Extra headroom";
  return "Very loose fit";
}

function pickBestStub(
  rows: StubBoxRow[],
  style: "RSC" | "MAILER",
  footprintL: number,
  footprintW: number,
  stackDepth: number,
): SuggestedBox | undefined {
  let best: SuggestedBox | undefined;

  for (const row of rows) {
    if (row.style !== style) continue;
    const score = computeFitScore(row, footprintL, footprintW, stackDepth);
    if (score === null) continue;

    const candidate: SuggestedBox = {
      ...row,
      fit_score: score,
      notes: describeFit(score),
    };

    if (!best || candidate.fit_score > best.fit_score) {
      best = candidate;
    }
  }

  return best;
}

function pickBestFromDbRows(
  dbRows: BoxSuggestion[],
  style: "RSC" | "MAILER",
  footprintL: number,
  footprintW: number,
  stackDepth: number,
): SuggestedBox | null {
  if (!Array.isArray(dbRows) || dbRows.length === 0) return null;

  const stubRows: StubBoxRow[] = dbRows.map((b) => ({
    sku: b.sku,
    description: b.description,
    style,
    inside_length_in: b.inside_length_in,
    inside_width_in: b.inside_width_in,
    inside_height_in: b.inside_height_in,
  }));

  const best = pickBestStub(
    stubRows,
    style,
    footprintL,
    footprintW,
    stackDepth,
  );

  // Normalize undefined → null so the signature stays SuggestedBox | null
  return best ?? null;
}



export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<BoxSuggestIn>;

    const L = Number(body.footprint_length_in) || 0;
    const W = Number(body.footprint_width_in) || 0;
    const H = Number(body.stack_depth_in) || 0;

    if (L <= 0 || W <= 0 || H <= 0) {
      const resp: BoxSuggestOut = {
        ok: false,
        error: "Invalid or incomplete dimensions.",
      };
      return NextResponse.json(resp);
    }

        // Use the live Box Partners catalog stored in public.boxes.
    const requiredL = L;
    const requiredW = W;
    const requiredH = H;

    // Pull candidates for each style from the DB.
    const [rscRows, mailerRows] = await Promise.all([
      fetchBoxesForStyle(requiredL, requiredW, requiredH, "rsc"),
      fetchBoxesForStyle(requiredL, requiredW, requiredH, "mailer"),
    ]);

    const bestRsc = pickBestFromDbRows(
      rscRows,
      "RSC",
      requiredL,
      requiredW,
      requiredH,
    );
    const bestMailer = pickBestFromDbRows(
      mailerRows,
      "MAILER",
      requiredL,
      requiredW,
      requiredH,
    );

    if (!bestRsc && !bestMailer) {
      const resp: BoxSuggestOut = {
        ok: false,
        error: "No cartons in the live boxes catalog fit these dimensions.",
      };
      return NextResponse.json(resp);
    }

const resp: BoxSuggestOut = {
  ok: true,
  bestRsc: bestRsc ?? null,
  bestMailer: bestMailer ?? null,
};

return NextResponse.json(resp);



  } catch (err: any) {
    console.error("Box suggester POST error", err);
    const resp: BoxSuggestOut = {
      ok: false,
      error: "Unexpected error in box suggester.",
    };
    return NextResponse.json(resp, { status: 500 });
  }
}

/* =======================================================================
   GET: quote-based suggester for QuotePrintClient
   ======================================================================= */

type QuoteDimsRow = {
  length_in: any;
  width_in: any;
  height_in: any;
  qty: any;
};

type LayoutJsonRow = {
  layout_json: any;
};

type BoxDbRow = {
  id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: any;
  inside_width_in: any;
  inside_height_in: any;
  min_order_qty: any;
  bundle_qty: any;
  notes: string | null;
};

type BoxesBlock = {
  length_in: number;
  width_in: number;
  height_in: number;
  clearance_in: number;
  required_inside: {
    length_in: number;
    width_in: number;
    height_in: number;
  };
};

type BoxSuggestion = {
  id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  min_order_qty: number | null;
  bundle_qty: number | null;
  notes: string | null;
  volume: number;
};

type BoxesOk = {
  ok: true;
  block: BoxesBlock;
  style_mode: "rsc" | "mailer" | "both" | string;
  rsc: BoxSuggestion[];
  mailer: BoxSuggestion[];
};

type BoxesErr = {
  ok: false;
  error: string;
};

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function coerceBoxSuggestion(row: BoxDbRow): BoxSuggestion | null {
  const L = toNumberOrNull(row.inside_length_in);
  const W = toNumberOrNull(row.inside_width_in);
  const H = toNumberOrNull(row.inside_height_in);

  if (L === null || W === null || H === null) {
    return null;
  }

  const vendor =
    row.vendor && row.vendor.trim().length > 0
      ? row.vendor.trim()
      : "Box vendor";

  const style =
    row.style && row.style.trim().length > 0 ? row.style.trim() : "RSC";

  const volume = L * W * H;

  return {
    id: row.id,
    vendor,
    style,
    sku: row.sku,
    description: row.description ?? "",
    inside_length_in: L,
    inside_width_in: W,
    inside_height_in: H,
    min_order_qty: toNumberOrNull(row.min_order_qty),
    bundle_qty: toNumberOrNull(row.bundle_qty),
    notes: row.notes ?? null,
    volume,
  };
}

async function fetchBoxesForStyle(
  requiredL: number,
  requiredW: number,
  requiredH: number,
  styleFilter: "rsc" | "mailer",
): Promise<BoxSuggestion[]> {
  const styleValue = styleFilter === "rsc" ? "rsc" : "mailer";

  const rows = (await q<BoxDbRow>(
    `
      select
        id,
        sku,
        vendor,
        style,
        description,
        inside_length_in,
        inside_width_in,
        inside_height_in,
        min_order_qty,
        bundle_qty,
        notes
      from public.boxes
      where
        inside_length_in >= $1
        and inside_width_in >= $2
        and inside_height_in >= $3
        and lower(coalesce(style, '')) = $4
      order by inside_length_in * inside_width_in * inside_height_in asc
      limit 10
    `,
    [requiredL, requiredW, requiredH, styleValue],
  )) as BoxDbRow[];

  const out: BoxSuggestion[] = [];

  for (const row of rows) {
    const s = coerceBoxSuggestion(row);
    if (s) out.push(s);
  }

  return out;
}

// Fallback: if we can't find dims from quote_items, try the latest layout_json
async function deriveDimsFromLayout(quoteNo: string): Promise<QuoteDimsRow | null> {
  const layoutRow = await one<LayoutJsonRow>(
    `
      select layout_json
      from public.quote_layout_packages
      where quote_id = (
        select id from public."quotes" where quote_no = $1 limit 1
      )
      order by created_at desc
      limit 1
    `,
    [quoteNo],
  );

  if (!layoutRow || !layoutRow.layout_json) return null;

  const layout = layoutRow.layout_json;
  const block = layout.block || layout.block_in || layout.block_dims || null;
  if (!block) return null;

  // support both camelCase and snake_case, just in case
  const L =
    toNumberOrNull((block as any).lengthIn) ??
    toNumberOrNull((block as any).length_in);
  const W =
    toNumberOrNull((block as any).widthIn) ??
    toNumberOrNull((block as any).width_in);
  const H =
    toNumberOrNull((block as any).thicknessIn) ??
    toNumberOrNull((block as any).height_in);

  if (L === null || W === null || H === null) return null;

  return {
    length_in: L,
    width_in: W,
    height_in: H,
    qty: 1,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const quoteNoRaw = url.searchParams.get("quote_no");
    const styleRaw = url.searchParams.get("style");

    const quoteNo = quoteNoRaw ? quoteNoRaw.trim() : "";
    if (!quoteNo) {
      const body: BoxesErr = {
        ok: false,
        error: "Missing quote_no query parameter.",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const styleParam = styleRaw ? styleRaw.trim().toLowerCase() : "both";
    const styleMode: "rsc" | "mailer" | "both" | string =
      styleParam === "rsc" || styleParam === "mailer" || styleParam === "both"
        ? styleParam
        : "both";

    // First try: primary line item dims for this quote
    let dims = await one<QuoteDimsRow>(
      `
        select
          qi.length_in,
          qi.width_in,
          qi.height_in,
          qi.qty
        from public."quotes" as q
        join public.quote_items as qi
          on qi.quote_id = q.id
        where q.quote_no = $1
        order by qi.id asc
        limit 1
      `,
      [quoteNo],
    );

    // Fallback: derive from latest layout_json.block if we didn't find a line item
    if (!dims) {
      dims = await deriveDimsFromLayout(quoteNo);
    }

    if (!dims) {
      const body: BoxesErr = {
        ok: false,
        error:
          "Unable to derive foam block dimensions for this quote yet. Save a layout or primary line item first.",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const L = toNumberOrNull(dims.length_in) ?? 0;
    const W = toNumberOrNull(dims.width_in) ?? 0;
    const H = toNumberOrNull(dims.height_in) ?? 0;

    if (!(L > 0 && W > 0 && H > 0)) {
      const body: BoxesErr = {
        ok: false,
        error:
          "Quote dimensions are missing or invalid for box suggestions.",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const clearance = 0.5; // 0.5" all around for now
    const requiredInsideL = L + clearance * 2;
    const requiredInsideW = W + clearance * 2;
    const requiredInsideH = H + clearance * 2;

    const block: BoxesBlock = {
      length_in: L,
      width_in: W,
      height_in: H,
      clearance_in: clearance,
      required_inside: {
        length_in: requiredInsideL,
        width_in: requiredInsideW,
        height_in: requiredInsideH,
      },
    };

    let rsc: BoxSuggestion[] = [];
    let mailer: BoxSuggestion[] = [];

    if (styleMode === "rsc" || styleMode === "both") {
      rsc = await fetchBoxesForStyle(
        requiredInsideL,
        requiredInsideW,
        requiredInsideH,
        "rsc",
      );
    }

    if (styleMode === "mailer" || styleMode === "both") {
      mailer = await fetchBoxesForStyle(
        requiredInsideL,
        requiredInsideW,
        requiredInsideH,
        "mailer",
      );
    }

    const body: BoxesOk = {
      ok: true,
      block,
      style_mode: styleMode,
      rsc,
      mailer,
    };

    return NextResponse.json(body);
  } catch (err: any) {
    console.error("Error in /api/boxes/suggest GET:", err);
    const body: BoxesErr = {
      ok: false,
      error:
        typeof err?.message === "string"
          ? err.message
          : "Unexpected error loading box suggestions for this quote.",
    };
    return NextResponse.json(body, { status: 500 });
  }
}
