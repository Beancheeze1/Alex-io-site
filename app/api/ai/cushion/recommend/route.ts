// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cushion recommender for the AI chat bot.
 *
 * Path A enhancement:
 * - Prefer "in-house" foams first (your most common SKUs/grades),
 *   but still allow fallback to other materials if needed.
 * - Uses /api/materials (DB-backed) so ids/prices/densities are real.
 *
 * INPUT (examples):
 *  {
 *    "dims": { "L":12, "W":9, "H":2, "units":"in" },
 *    "weight_lb": 8,               // optional
 *    "drop_height_in": 24,         // optional
 *    "fragility": "low|med|high"   // optional
 *  }
 */

type Units = "in" | "mm";
const MM_PER_IN = 25.4;

function toInches(n: number, u: Units) {
  return u === "mm" ? n / MM_PER_IN : n;
}

// Materials API shape (best-effort; keep tolerant)
type MaterialsApiResponse = {
  materials?: Array<{
    id: number;
    name?: string;
    material_name?: string;
    family?: string;
    material_family?: string;
    density_lb_ft3?: number | string | null; // pcf
    price_per_cu_in?: number | string | null;
    min_charge?: number | string | null;
    status?: string;
    active?: boolean;
  }>;
};

function norm(s: any): string {
  return String(s ?? "").trim();
}

function lower(s: any): string {
  return norm(s).toLowerCase();
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Your in-house preference order (most common → less common)
const IN_HOUSE_ORDER: Array<{
  label: string;
  familyMust?: string; // exact family name when known
  nameIncludes: string[]; // all must match (case-insensitive)
}> = [
  { label: "1.7# PE", familyMust: "Polyethylene", nameIncludes: ["1.7", "#"] },
  { label: "2# PE", familyMust: "Polyethylene", nameIncludes: ["2", "#"] },

  // PU grades (common naming is typically numeric like 1780 / 1560 / 1030)
  { label: "1780 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1780"] },
  { label: "1560 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1560"] },
  { label: "2# PU", familyMust: "Polyurethane Foam", nameIncludes: ["2", "#"] },
  { label: "1030 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1030"] },

  // XLPE (naming varies: XLPE / crosslinked / cross-linked)
  { label: "2# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe", "2"] },
  { label: "4# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe", "4"] },
];

// Returns a 0-based rank if in-house preferred, else null
function inHouseRank(m: {
  name: string;
  family: string;
}): number | null {
  const n = lower(m.name);
  const f = norm(m.family);

  for (let i = 0; i < IN_HOUSE_ORDER.length; i++) {
    const rule = IN_HOUSE_ORDER[i];

    // Enforce family gate when provided.
    // This protects PE vs EPE separation (Expanded Polyethylene != Polyethylene).
    if (rule.familyMust && f !== rule.familyMust) continue;

    const ok = rule.nameIncludes.every((tok) => n.includes(tok.toLowerCase()));
    if (ok) return i;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<{
      dims: { L: number; W: number; H: number; units?: Units };
      weight_lb?: number;
      drop_height_in?: number;
      fragility?: "low" | "med" | "high";
    }>;

    const dims = body?.dims;
    if (!dims) {
      return NextResponse.json({ ok: false, error: "dims required" }, { status: 400 });
    }

    const u = (dims.units ?? "in") as Units;
    const L = toInches(Number(dims.L || 0), u);
    const W = toInches(Number(dims.W || 0), u);
    const H = toInches(Number(dims.H || 0), u);
    if (!(L > 0 && W > 0 && H > 0)) {
      return NextResponse.json({ ok: false, error: "invalid dims" }, { status: 400 });
    }

    // Heuristic density choice
    const weight = Number(body.weight_lb ?? 5);
    const drop = Number(body.drop_height_in ?? 24);
    const frag = body.fragility ?? "med";

    // Rough heuristic:
    // - heavier or higher drop or "high" fragility pushes density upward.
    let score = 0;
    score += Math.min(3, Math.max(0, weight / 10)); // 0..3
    score += Math.min(2, Math.max(0, drop / 24 - 1)); // 0..2
    if (frag === "high") score += 2;
    else if (frag === "med") score += 1;

    let density_pcf = 1.7;
    if (score >= 4.5) density_pcf = 4.0;
    else if (score >= 2.5) density_pcf = 2.2;

    // Load real materials from DB-backed API
    const origin = new URL(req.url).origin;
    let catalog: Array<{
      id: number;
      name: string;
      family: string;
      density_pcf: number | null;
      price_per_cu_in: number | null;
      min_charge: number | null;
      active: boolean;
    }> = [];

    try {
      const res = await fetch(`${origin}/api/materials`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as MaterialsApiResponse;

        const mats = Array.isArray(json.materials) ? json.materials : [];
        catalog = mats
          .map((m) => {
            const id = Number(m.id);
            const name = norm(m.name ?? m.material_name ?? `Material #${id}`);
            const family = norm(m.material_family ?? m.family ?? "");
            const density_pcf = num(m.density_lb_ft3);
            const price_per_cu_in = num(m.price_per_cu_in);
            const min_charge = num(m.min_charge);

            // "active" signal varies; keep tolerant
            const status = lower(m.status);
            const active =
              m.active === true ||
              status === "active" ||
              status === "enabled" ||
              status === "";

            return { id, name, family, density_pcf, price_per_cu_in, min_charge, active };
          })
          .filter((m) => Number.isFinite(m.id) && m.id > 0);
      }
    } catch {
      // If /api/materials fails, fall through to empty catalog (we’ll still return a response).
    }

    // Filter to active materials when possible (but don’t hard-fail)
    const activeCatalog = catalog.some((m) => m.active)
      ? catalog.filter((m) => m.active)
      : catalog;

    // Rank & select candidates
    // Priority:
    //  1) in-house rank (your list)
    //  2) closest density to heuristic target
    //  3) lower price_per_cu_in when available (ties only)
    //  4) stable fallback by name
    const candidatesRaw = [...activeCatalog];

    candidatesRaw.sort((a, b) => {
      const ra = inHouseRank(a);
      const rb = inHouseRank(b);

      const aIn = ra != null;
      const bIn = rb != null;

      if (aIn && bIn) {
        if (ra !== rb) return ra - rb;
      } else if (aIn && !bIn) return -1;
      else if (!aIn && bIn) return 1;

      const da =
        a.density_pcf != null ? Math.abs(a.density_pcf - density_pcf) : 9999;
      const db =
        b.density_pcf != null ? Math.abs(b.density_pcf - density_pcf) : 9999;
      if (da !== db) return da - db;

      const pa = a.price_per_cu_in ?? 9999;
      const pb = b.price_per_cu_in ?? 9999;
      if (pa !== pb) return pa - pb;

      return a.name.localeCompare(b.name);
    });

    // Return up to 8 candidates (your in-house list length)
    const candidates = candidatesRaw.slice(0, 8).map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      density_pcf: m.density_pcf,
      price_per_cu_in: m.price_per_cu_in,
      min_charge: m.min_charge,
      in_house_rank: inHouseRank(m), // null when not in-house
    }));

    const resp = {
      ok: true,
      status: 200,
      hasHints: true,
      recommended_density_pcf: density_pcf,
      candidates,
      diag: {
        dims_in: { L, W, H },
        weight_lb: weight,
        drop_height_in: drop,
        fragility: frag,
        in_house_order: IN_HOUSE_ORDER.map((r) => r.label),
        catalog_count: activeCatalog.length,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
