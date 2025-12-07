// app/api/boxes/suggest/route.ts
//
// Box suggester (stubbed catalog, Path A safe).
// POST /api/boxes/suggest
//
// Input:
//   {
//     footprint_length_in: number;
//     footprint_width_in: number;
//     stack_depth_in: number;
//     qty?: number | null;
//   }
//
// Output:
//   {
//     ok: boolean;
//     bestRsc?: { ... };
//     bestMailer?: { ... };
//     error?: string;
//   }

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BoxSuggestIn = {
  footprint_length_in: number;
  footprint_width_in: number;
  stack_depth_in: number;
  qty?: number | null;
};

type BoxRow = {
  sku: string;
  description: string;
  style: "RSC" | "MAILER";
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
};

type SuggestedBox = BoxRow & {
  fit_score: number; // 0–100 (higher = tighter but still valid)
  notes?: string;
};

type BoxSuggestOut = {
  ok: boolean;
  bestRsc?: SuggestedBox;
  bestMailer?: SuggestedBox;
  error?: string;
};

// Tiny stub catalog (replace with real Box Partners data later).
const CATALOG: BoxRow[] = [
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
  box: BoxRow,
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
    if (
      footprintL <= boxL &&
      footprintW <= boxW &&
      stackDepth <= boxH
    ) {
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

function pickBest(
  rows: BoxRow[],
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

    const bestRsc = pickBest(CATALOG, "RSC", L, W, H);
    const bestMailer = pickBest(CATALOG, "MAILER", L, W, H);

    if (!bestRsc && !bestMailer) {
      const resp: BoxSuggestOut = {
        ok: false,
        error: "No cartons in the stub catalog fit these dimensions.",
      };
      return NextResponse.json(resp);
    }

    const resp: BoxSuggestOut = {
      ok: true,
      bestRsc: bestRsc,
      bestMailer: bestMailer,
    };

    return NextResponse.json(resp);
  } catch (err: any) {
    console.error("Box suggester error", err);
    const resp: BoxSuggestOut = {
      ok: false,
      error: "Unexpected error in box suggester.",
    };
    return NextResponse.json(resp, { status: 500 });
  }
}
