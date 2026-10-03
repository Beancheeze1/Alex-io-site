// lib/demo-material.ts
//
// Resolves which material a public demo quote should use.
// Order: explicit active materialId -> exact material name -> family+density
// parsed from materialText -> documented default (active Polyethylene closest
// to 1.7 lb).
// Never silently falls back to an arbitrary row: if the default itself is
// missing, this throws so the caller returns a loud 500.

import { one } from "@/lib/db";

export type DemoMaterialResolution = "id" | "text" | "default";

export type DemoMaterial = {
  id: number;
  name: string;
  family: string;
  density: number | null;
  resolution: DemoMaterialResolution;
};

type Row = {
  id: number;
  name: string;
  material_family: string;
  density_lb_ft3: string | number | null;
};

const ACTIVE_MATERIALS_SQL = `
  SELECT id, name, material_family, density_lb_ft3
  FROM public.materials
  WHERE COALESCE(is_active, true) = true
`;

const DEFAULT_FAMILY = "Polyethylene";
const DEFAULT_DENSITY = 1.7;

function toMaterial(r: Row, resolution: DemoMaterialResolution): DemoMaterial {
  const d = r.density_lb_ft3 === null ? null : Number(r.density_lb_ft3);
  return {
    id: Number(r.id),
    name: String(r.name),
    family: String(r.material_family),
    density: d !== null && Number.isFinite(d) ? d : null,
    resolution,
  };
}

/** Maps free text like "Polyethylene 1.7 PCF" to a materials.material_family value. */
export function familyFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bxlpe\b|cross[\s-]?link/.test(t)) return "XLPE";
  if (/expanded\s+polyeth|\bepe\b/.test(t)) return "Expanded Polyethylene";
  if (/polyeth|\bpe\b/.test(t)) return "Polyethylene";
  if (/urethane|\bpu\b|\bester\b|\bether\b/.test(t)) return "Polyurethane Foam";
  return null;
}

/** Pulls a density in lb/ft3 from text like "1.7 PCF", "2.2#", "4 lb". */
export function densityFromText(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:#|lbs?\b|pcf\b|pounds?\b)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}

async function closestInFamily(family: string, density: number): Promise<Row | null> {
  return one<Row>(
    `${ACTIVE_MATERIALS_SQL}
      AND material_family = $1
    ORDER BY ABS(COALESCE(density_lb_ft3, 999) - $2::numeric) ASC, id ASC
    LIMIT 1`,
    [family, density],
  );
}

export async function resolveDemoMaterial(input: {
  materialId?: unknown;
  materialText?: unknown;
}): Promise<DemoMaterial> {
  const idNum =
    typeof input.materialId === "number" ? input.materialId : Number(input.materialId ?? NaN);
  if (Number.isInteger(idNum) && idNum > 0) {
    const r = await one<Row>(`${ACTIVE_MATERIALS_SQL} AND id = $1 LIMIT 1`, [idNum]);
    if (r) return toMaterial(r, "id");
  }

  const text = typeof input.materialText === "string" ? input.materialText.trim() : "";
  if (text) {
    // Exact product name first (e.g. "Ester 1560", "1.7# White").
    const byName = await one<Row>(
      `${ACTIVE_MATERIALS_SQL} AND lower(name) = lower($1) ORDER BY id ASC LIMIT 1`,
      [text],
    );
    if (byName) return toMaterial(byName, "text");

    const family = familyFromText(text);
    if (family) {
      const r = await closestInFamily(family, densityFromText(text) ?? DEFAULT_DENSITY);
      if (r) return toMaterial(r, "text");
    }
  }

  const def = await closestInFamily(DEFAULT_FAMILY, DEFAULT_DENSITY);
  if (!def) {
    throw new Error(
      `demo_default_material_missing: no active "${DEFAULT_FAMILY}" material found for demo quotes`,
    );
  }
  return toMaterial(def, "default");
}
