// lib/corrugated.ts
//
// Per-shop corrugated settings (Admin -> Corrugated): board grades, run and
// print rates, and scoring/layout. Server only (DB). Pure math and defaults
// live in lib/corrugated-blank.ts. Tables: migrations/025_corrugated_settings.sql.

import { q, one, withTxn } from "@/lib/db";
import {
  DEFAULT_FLUTES,
  DEFAULT_GRADES,
  JOINT_TYPES,
  RATE_FIELDS,
  ROUND_TO_OPTIONS,
  type CorrugatedRates,
  type FluteSpec,
  type JointType,
} from "@/lib/corrugated-blank";

export type CorrugatedSettings = CorrugatedRates & {
  joint_type: JointType;
  flap_pct: number;
  round_to_in: number;
  edge_trim_in: number;
};

export type BoardGrade = {
  id: number;
  name: string;
  flute: string;
  ect_label: string;
  cost_per_msf: number | null;
  active: boolean;
  is_default: boolean;
  sort_order: number;
};

export type CorrugatedConfig = {
  settings: CorrugatedSettings;
  flutes: FluteSpec[];
  grades: BoardGrade[];
};

export type GradeInput = {
  id: number | null;
  name: string;
  flute: string;
  ect_label: string;
  cost_per_msf: number | null;
  active: boolean;
  is_default: boolean;
};

export type CorrugatedInput = {
  settings: CorrugatedSettings;
  flutes: FluteSpec[];
  grades: GradeInput[];
};

const LAYOUT_COLS = ["joint_type", "flap_pct", "round_to_in", "edge_trim_in"] as const;

/**
 * Seeds a tenant's settings row, default flutes and default grades — once,
 * the first time (only the request that creates the settings row seeds).
 */
export async function ensureCorrugatedDefaults(tenantId: number): Promise<void> {
  await withTxn(async (tx) => {
    const created = await tx.query(
      `INSERT INTO public.corrugated_settings (tenant_id) VALUES ($1)
       ON CONFLICT (tenant_id) DO NOTHING
       RETURNING tenant_id`,
      [tenantId],
    );
    if (!created.rowCount) return;

    for (let i = 0; i < DEFAULT_FLUTES.length; i++) {
      const f = DEFAULT_FLUTES[i];
      await tx.query(
        `INSERT INTO public.corrugated_flutes
           (tenant_id, flute, caliper_in, panel_allow_in, last_panel_adj_in,
            depth_allow_in, flap_allow_in, glue_joint_in, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [tenantId, f.flute, f.caliper_in, f.panel_allow_in, f.last_panel_adj_in,
         f.depth_allow_in, f.flap_allow_in, f.glue_joint_in, i],
      );
    }

    for (let i = 0; i < DEFAULT_GRADES.length; i++) {
      const g = DEFAULT_GRADES[i];
      await tx.query(
        `INSERT INTO public.corrugated_board_grades
           (tenant_id, name, flute, ect_label, cost_per_msf, active, is_default, sort_order)
         VALUES ($1, $2, $3, $4, NULL, true, $5, $6)
         ON CONFLICT DO NOTHING`,
        [tenantId, g.name, g.flute, g.ect_label, g.is_default, i],
      );
    }
  });
}

export async function loadCorrugated(tenantId: number): Promise<CorrugatedConfig> {
  await ensureCorrugatedDefaults(tenantId);

  const s = await one<Record<string, any>>(
    `SELECT * FROM public.corrugated_settings WHERE tenant_id = $1`,
    [tenantId],
  );

  const rates = {} as CorrugatedRates;
  for (const f of RATE_FIELDS) rates[f.key] = Number(s?.[f.key] ?? 0);

  const settings: CorrugatedSettings = {
    ...rates,
    joint_type: (JOINT_TYPES.includes(s?.joint_type) ? s?.joint_type : "glued") as JointType,
    flap_pct: Number(s?.flap_pct ?? 50),
    round_to_in: Number(s?.round_to_in ?? 0.0625),
    edge_trim_in: Number(s?.edge_trim_in ?? 0),
  };

  const flRows = await q<Record<string, any>>(
    `SELECT flute, caliper_in, panel_allow_in, last_panel_adj_in, depth_allow_in,
            flap_allow_in, glue_joint_in
       FROM public.corrugated_flutes
      WHERE tenant_id = $1
      ORDER BY sort_order, flute`,
    [tenantId],
  );
  const flutes: FluteSpec[] = flRows.map((r) => ({
    flute: String(r.flute),
    caliper_in: Number(r.caliper_in),
    panel_allow_in: Number(r.panel_allow_in),
    last_panel_adj_in: Number(r.last_panel_adj_in),
    depth_allow_in: Number(r.depth_allow_in),
    flap_allow_in: Number(r.flap_allow_in),
    glue_joint_in: Number(r.glue_joint_in),
  }));

  const grRows = await q<Record<string, any>>(
    `SELECT id, name, flute, ect_label, cost_per_msf, active, is_default, sort_order
       FROM public.corrugated_board_grades
      WHERE tenant_id = $1
      ORDER BY sort_order, id`,
    [tenantId],
  );
  const grades: BoardGrade[] = grRows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    flute: String(r.flute),
    ect_label: String(r.ect_label ?? ""),
    cost_per_msf: r.cost_per_msf === null || r.cost_per_msf === undefined ? null : Number(r.cost_per_msf),
    active: r.active === true,
    is_default: r.is_default === true,
    sort_order: Number(r.sort_order ?? 0),
  }));

  return { settings, flutes, grades };
}

/** Replaces the tenant's settings, flutes and grades with a validated input. */
export async function saveCorrugated(tenantId: number, input: CorrugatedInput): Promise<void> {
  await ensureCorrugatedDefaults(tenantId);

  await withTxn(async (tx) => {
    // Settings row. Column names come from constants, never from input.
    const cols: string[] = [...RATE_FIELDS.map((f) => f.key), ...LAYOUT_COLS];
    const vals = cols.map((c) => (input.settings as Record<string, unknown>)[c]);
    const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await tx.query(
      `UPDATE public.corrugated_settings SET ${setSql}, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, ...vals],
    );

    // Flutes: remove the ones no longer listed, upsert the rest in order.
    const codes = input.flutes.map((f) => f.flute);
    await tx.query(
      `DELETE FROM public.corrugated_flutes WHERE tenant_id = $1 AND NOT (flute = ANY($2::text[]))`,
      [tenantId, codes],
    );
    for (let i = 0; i < input.flutes.length; i++) {
      const f = input.flutes[i];
      await tx.query(
        `INSERT INTO public.corrugated_flutes
           (tenant_id, flute, caliper_in, panel_allow_in, last_panel_adj_in,
            depth_allow_in, flap_allow_in, glue_joint_in, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ON CONSTRAINT corrugated_flutes_tenant_flute_key DO UPDATE SET
           caliper_in = EXCLUDED.caliper_in,
           panel_allow_in = EXCLUDED.panel_allow_in,
           last_panel_adj_in = EXCLUDED.last_panel_adj_in,
           depth_allow_in = EXCLUDED.depth_allow_in,
           flap_allow_in = EXCLUDED.flap_allow_in,
           glue_joint_in = EXCLUDED.glue_joint_in,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
        [tenantId, f.flute, f.caliper_in, f.panel_allow_in, f.last_panel_adj_in,
         f.depth_allow_in, f.flap_allow_in, f.glue_joint_in, i],
      );
    }

    // Grades: clear the default first (one-default index), drop removed rows,
    // then update kept rows by id and insert new ones.
    await tx.query(
      `UPDATE public.corrugated_board_grades SET is_default = false
        WHERE tenant_id = $1 AND is_default`,
      [tenantId],
    );
    const keepIds = input.grades.filter((g) => g.id !== null).map((g) => g.id as number);
    await tx.query(
      `DELETE FROM public.corrugated_board_grades
        WHERE tenant_id = $1 AND NOT (id = ANY($2::bigint[]))`,
      [tenantId, keepIds],
    );
    for (let i = 0; i < input.grades.length; i++) {
      const g = input.grades[i];
      const params = [tenantId, g.name, g.flute, g.ect_label, g.cost_per_msf, g.active, g.is_default, i];
      let updated = false;
      if (g.id !== null) {
        const r = await tx.query(
          `UPDATE public.corrugated_board_grades
              SET name = $2, flute = $3, ect_label = $4, cost_per_msf = $5,
                  active = $6, is_default = $7, sort_order = $8, updated_at = now()
            WHERE tenant_id = $1 AND id = $9`,
          [...params, g.id],
        );
        updated = (r.rowCount ?? 0) > 0;
      }
      if (!updated) {
        await tx.query(
          `INSERT INTO public.corrugated_board_grades
             (tenant_id, name, flute, ect_label, cost_per_msf, active, is_default, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          params,
        );
      }
    }
  });
}

// ---------- validation ----------

class FieldError extends Error {
  isFieldError = true;
}

function numIn(v: unknown, label: string, min: number, max: number): number {
  const x =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(x) || x < min || x > max) {
    throw new FieldError(`${label} must be a number from ${min} to ${max}.`);
  }
  return x;
}

export function validateCorrugatedInput(
  body: unknown,
): { ok: true; value: CorrugatedInput } | { ok: false; message: string } {
  try {
    if (!body || typeof body !== "object") {
      throw new FieldError("Expected { settings, flutes, grades }.");
    }
    const b = body as Record<string, any>;
    const s = (b.settings ?? {}) as Record<string, unknown>;

    const rates = {} as CorrugatedRates;
    for (const f of RATE_FIELDS) rates[f.key] = numIn(s[f.key], f.label, 0, f.max);

    const joint_type = String(s.joint_type ?? "") as JointType;
    if (!JOINT_TYPES.includes(joint_type)) {
      throw new FieldError("Joint type must be glued, stitched or taped.");
    }
    const flap_pct = numIn(s.flap_pct, "Flap size %", 25, 75);
    const roundRaw = numIn(s.round_to_in, "Round blank up to", 0, 1);
    const round_to_in = ROUND_TO_OPTIONS.find((o) => Math.abs(o - roundRaw) < 1e-6);
    if (round_to_in === undefined) {
      throw new FieldError("Round blank up to must be 1/16, 1/8 or 1/4 inch.");
    }
    const edge_trim_in = numIn(s.edge_trim_in, "Edge trim", 0, 2);

    if (!Array.isArray(b.flutes) || b.flutes.length < 1 || b.flutes.length > 12) {
      throw new FieldError("List between 1 and 12 flutes under Scoring and layout.");
    }
    const fluteCodes = new Set<string>();
    const flutes: FluteSpec[] = b.flutes.map((f: any) => {
      const code = String(f?.flute ?? "").trim().toUpperCase();
      if (!/^[A-Z]{1,4}$/.test(code)) {
        throw new FieldError(`Flute "${code || "(blank)"}": use 1 to 4 letters, e.g. C or BC.`);
      }
      if (fluteCodes.has(code)) throw new FieldError(`Flute ${code} is listed twice.`);
      fluteCodes.add(code);
      return {
        flute: code,
        caliper_in: numIn(f.caliper_in, `Flute ${code} caliper`, 0.001, 1),
        panel_allow_in: numIn(f.panel_allow_in, `Flute ${code} panel allowance`, 0, 1),
        last_panel_adj_in: numIn(f.last_panel_adj_in, `Flute ${code} last-panel adjustment`, -1, 1),
        depth_allow_in: numIn(f.depth_allow_in, `Flute ${code} depth allowance`, 0, 1),
        flap_allow_in: numIn(f.flap_allow_in, `Flute ${code} flap allowance`, 0, 1),
        glue_joint_in: numIn(f.glue_joint_in, `Flute ${code} glue joint`, 0, 3),
      };
    });

    if (!Array.isArray(b.grades) || b.grades.length > 50) {
      throw new FieldError("Board grades must be a list of up to 50.");
    }
    const names = new Set<string>();
    const grades: GradeInput[] = b.grades.map((g: any) => {
      const name = String(g?.name ?? "").trim();
      if (!name || name.length > 60) {
        throw new FieldError("Every board grade needs a name (up to 60 characters).");
      }
      if (names.has(name.toLowerCase())) throw new FieldError(`Board grade "${name}" is listed twice.`);
      names.add(name.toLowerCase());

      const flute = String(g.flute ?? "").trim().toUpperCase();
      if (!fluteCodes.has(flute)) {
        throw new FieldError(
          `Board grade "${name}" uses flute ${flute || "(none)"}, which has no row under Scoring and layout. Add that flute or pick another.`,
        );
      }
      const ect_label = String(g.ect_label ?? "").trim();
      if (ect_label.length > 30) throw new FieldError(`Board grade "${name}": ECT / test is too long.`);

      const cost_per_msf =
        g.cost_per_msf === null || g.cost_per_msf === undefined || g.cost_per_msf === ""
          ? null
          : numIn(g.cost_per_msf, `Board grade "${name}" cost per MSF`, 0, 100000);

      const id = g.id === null || g.id === undefined ? null : Number(g.id);
      if (id !== null && (!Number.isInteger(id) || id <= 0)) {
        throw new FieldError(`Board grade "${name}" has an invalid id.`);
      }
      return { id, name, flute, ect_label, cost_per_msf, active: g.active === true, is_default: g.is_default === true };
    });

    const defaults = grades.filter((g) => g.is_default);
    if (defaults.length > 1) throw new FieldError("Pick only one default board grade.");
    if (defaults.length === 1 && !defaults[0].active) {
      throw new FieldError("The default board grade must be active.");
    }
    if (grades.some((g) => g.active) && defaults.length !== 1) {
      throw new FieldError("Pick a default board grade.");
    }

    return {
      ok: true,
      value: {
        settings: { ...rates, joint_type, flap_pct, round_to_in, edge_trim_in },
        flutes,
        grades,
      },
    };
  } catch (e) {
    if ((e as any)?.isFieldError) return { ok: false, message: (e as Error).message };
    throw e;
  }
}
