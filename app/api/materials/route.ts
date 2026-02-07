// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Units = "in" | "mm";
const MM_PER_IN = 25.4;

function toInches(n: number, u: Units) {
  return u === "mm" ? n / MM_PER_IN : n;
}

function norm(v: any): string {
  return String(v ?? "").trim();
}
function lower(v: any): string {
  return norm(v).toLowerCase();
}
function num(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type CatalogRow = {
  id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean | null;
};

type CatalogMaterial = {
  id: number;
  name: string;
  family: string;
  density_pcf: number | null;
  is_active: boolean | null;
};

// Your in-house preference order (most common → less common)
// NOTE: PE vs EPE separation is enforced via familyMust.
const IN_HOUSE_ORDER: Array<{
  label: string;
  familyMust?: string;
  // Optional substring tokens that must exist in name (case-insensitive)
  nameIncludes?: string[];
  // Optional density band (pcf) when naming is inconsistent
  densityBand?: { min: number; max: number };
}> = [
  { label: "1.7# PE", familyMust: "Polyethylene", densityBand: { min: 1.55, max: 1.85 } },
  { label: "2# PE", familyMust: "Polyethylene", densityBand: { min: 2.00, max: 2.40 } },

  { label: "1780 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1780"] },
  { label: "1560 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1560"] },
  { label: "2# PU", familyMust: "Polyurethane Foam", nameIncludes: ["2", "#"] },
  { label: "1030 PU", familyMust: "Polyurethane Foam", nameIncludes: ["1030"] },

  { label: "2# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe"], densityBand: { min: 2.00, max: 2.40 } },
  { label: "4# XLPE", familyMust: "Polyethylene", nameIncludes: ["xlpe"], densityBand: { min: 3.50, max: 4.60 } },
];

function inHouseRank(m: CatalogMaterial): number | null {
  const n = lower(m.name);
  const f = norm(m.family);
  const d = m.density_pcf;

  for (let i = 0; i < IN_HOUSE_ORDER.length; i++) {
    const rule = IN_HOUSE_ORDER[i];

    if (rule.familyMust && f !== rule.familyMust) continue;

    if (rule.nameIncludes && rule.nameIncludes.length) {
      const ok = rule.nameIncludes.every((tok) => n.includes(tok.toLowerCase()));
      if (!ok) continue;
    }

    if (rule.densityBand) {
      if (d == null) continue;
      if (d < rule.densityBand.min || d > rule.densityBand.max) continue;
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

    const weight = Number(body.weight_lb ?? 5);
    const drop = Number(body.drop_height_in ?? 24);
    const frag = body.fragility ?? "med";

    // Heuristic density choice
    let score = 0;
    score += Math.min(3, Math.max(0, weight / 10)); // 0..3
    score += Math.min(2, Math.max(0, drop / 24 - 1)); // 0..2
    if (frag === "high") score += 2;
    else if (frag === "med") score += 1;

    let density_pcf = 1.7;
    if (score >= 4.5) density_pcf = 4.0;
    else if (score >= 2.5) density_pcf = 2.2;

    // DB-backed materials load (no /api/materials)
    const rows = await q<CatalogRow>(`
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

    // Sort: in-house rank → density closeness → stable name
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
      in_house_rank: inHouseRank(m),
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
