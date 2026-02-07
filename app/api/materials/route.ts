// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cushion recommender for the AI chat bot.
 *
 * Path A:
 * - Prefer in-house foams first (your order), but allow fallbacks.
 * - IMPORTANT: Query DB directly (do NOT call /api/materials via fetch),
 *   because server-to-server HTTP can return empty due to auth/cookie context.
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
  familyMust?: string;          // exact family match (protects PE vs EPE)
  nameIncludes?: string[];      // all tokens must match (case-insensitive)
  densityBand?: { min: number; max: number }; // optional density band
}> = [
  // PE
  { label: "1.7# PE", familyMust: "Polyethylene", densityBand: { min: 1.55, max: 1.85 } },
  // Your DB may use 2.20 pcf for "2#"
  { label: "2# PE",   familyMust: "Polyethylene", densityBand: { min: 2.00, max: 2.40 } },

  // PU by grade code (name contains 1780/1560/1030 in your screenshot)
  { label: "1780 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1780"] },
  { label: "1560 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1560"] },
  // 2# PU (fallback within PU if you have “2#” naming)
  { label: "2# PU",   familyMust: "Polyurethane Foam", nameIncludes: ["2", "#"] },
  { label: "1030 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1030"] },

  // XLPE naming varies; we match name token "xlpe"
  { label: "2# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe"], densityBand: { min: 2.00, max: 2.40 } },
  { label: "4# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe"], densityBand: { min: 3.50, max: 4.60 } },
];

type CatalogMaterial = {
  id: number;
  name: string;
  family: string;
  density_pcf: number | null;
  is_active: boolean | null;
};

// Returns a 0-based rank if in-house preferred, else null
function inHouseRank(m: CatalogMaterial): number | null {
  const n = lower(m.name);
  const f = norm(m.family);
  const d = m.density_pcf;

  for (let i = 0; i < IN_HOUSE_ORDER.length; i++) {
    const rule = IN_HOUSE_ORDER[i];

    // Enforce family gate when provided (keeps PE vs EPE separate).
    if (rule.familyMust && f !== rule.familyMust) continue;

    if (rule.nameIncludes && rule.nameIncludes.length) {
      const ok = rule.nameIncludes.every((tok) => n.includes(tok.toLowerCase()));
      if (!ok) continue;
    }

    if (rule.densityBand && d != null) {
      if (d < rule.densityBand.min || d > rule.densityBand.max) continue;
    } else if (rule.densityBand && d == null) {
      // If we need density to decide and it's missing, treat as not a match
      continue;
    }

    return i;
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

    let score = 0;
    score += Math.min(3, Math.max(0, weight / 10));      // 0..3
    score += Math.min(2, Math.max(0, drop / 24 - 1));    // 0..2
    if (frag === "high") score += 2;
    else if (frag === "med") score += 1;

    let density_pcf = 1.7;
    if (score >= 4.5) density_pcf = 4.0;
    else if (score >= 2.5) density_pcf = 2.2;

    // ---- DB-backed materials load (Path A fix) ----
    const rows = await q<{
      id: number;
      material_name: string;
      material_family: string | null;
      density_lb_ft3: number | null;
      is_active: boolean | null;
    }>(`
      select
        id,
        name as material_name,
        material_family,
        density_lb_ft3,
        is_active
      from materials
      order by material_family, name;
    `);

    const catalog: CatalogMaterial[] = (rows || [])
      .map((r) => ({
        id: Number(r.id),
        name: norm(r.material_name),
        family: norm(r.material_family ?? ""),
        density_pcf: num(r.density_lb_ft3),
        is_active: r.is_active ?? null,
      }))
      .filter((m) => Number.isFinite(m.id) && m.id > 0);

    const activeCatalog =
      catalog.some((m) => m.is_active === false)
        ? catalog.filter((m) => m.is_active !== false)
        : catalog;

    // Rank & select candidates
    // Priority:
    //  1) in-house rank
    //  2) closest density to heuristic target
    //  3) stable fallback by name
    const sorted = [...activeCatalog].sort((a, b) => {
      const ra = inHouseRank(a);
      const rb = inHouseRank(b);

      const aIn = ra != null;
      const bIn = rb != null;

      if (aIn && bIn && ra !== rb) return ra - rb;
      if (aIn && !bIn) return -1;
      if (!aIn && bIn) return 1;

      const da = a.density_pcf != null ? Math.abs(a.density_pcf - density_pcf) : 9999;
      const db = b.density_pcf != null ? Math.abs(b.density_pcf - density_pcf) : 9999;
      if (da !== db) return da - db;

      return a.name.localeCompare(b.name);
    });

    const candidates = sorted.slice(0, 8).map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      density_pcf: m.density_pcf,
      in_house_rank: inHouseRank(m), // null if not in-house
    }));

    return NextResponse.json(
      {
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
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
