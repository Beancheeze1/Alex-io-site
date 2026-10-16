// app/lib/onboarding.ts
//
// Step 36A: what the "Get started" checklist can see for a shop
// (rules in app/lib/onboarding-core.ts), the steps it ticked by hand, and
// loading the starter rates.

import { one, q } from "@/lib/db";
import { getPricingSettings, updatePricingSettings, type PricingSettings } from "@/app/lib/pricing/settings";
import { loadCorrugated, saveCorrugated } from "@/lib/corrugated";
import {
  STARTER_CORRUGATED,
  STARTER_FOAM,
  checklist,
  starterGrades,
  starterPatch,
  type Checklist,
  type Signals,
} from "@/app/lib/onboarding-core";

const pos = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const txt = (v: unknown) => typeof v === "string" && v.trim() !== "";

export async function loadChecklist(tenantId: number): Promise<{ checklist: Checklist; slug: string } | null> {
  const t = await one<{ slug: string; theme_json: Record<string, unknown> | null }>(`SELECT slug, theme_json FROM public.tenants WHERE id = $1`, [tenantId]);
  if (!t) return null;
  const theme = (t.theme_json || {}) as Record<string, unknown>;

  const [settings, corr, mat, users, quotes, marked] = await Promise.all([
    getPricingSettings(tenantId).catch(() => null),
    loadCorrugated(tenantId).catch(() => null),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM public.tenant_material_prices WHERE tenant_id = $1`, [tenantId]).catch(() => null),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM public."users" WHERE tenant_id = $1 AND lower(email) NOT LIKE '25thhourdesign%'`,
      [tenantId],
    ).catch(() => null),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.quotes qq
        WHERE qq.tenant_id = $1 AND COALESCE((to_jsonb(qq) ->> 'is_demo')::boolean, false) = false
          AND qq.quote_no NOT LIKE 'Q-D-%' AND qq.quote_no NOT LIKE 'Q-DEMO-%'`,
      [tenantId],
    ).catch(() => null),
    q<{ step: string }>(`SELECT step FROM public.tenant_onboarding WHERE tenant_id = $1`, [tenantId]).catch(() => []),
  ]);

  const s = (settings || {}) as Record<string, unknown>;
  const freight = (s.freight || {}) as Record<string, unknown>;
  const signals: Signals = {
    shop_page: txt(theme.brandName) && (txt(theme.logoUrl) || txt(theme.primaryColor)) && (txt(theme.phone) || txt(theme.email)),
    materials: (Number(mat?.n) || 0) > 0,
    foam_rates: pos(s.cnc_cost_per_min) || pos(s.press_rate_per_hr) || pos(s.die_base_usd),
    corrugated: !!corr && corr.grades.some((g) => pos(g.cost_per_msf)) && pos(corr.settings.converting_per_m),
    freight: txt(freight.ship_from_zip),
    emails_terms: txt(s.reply_to_email) || txt(s.lead_time_text),
    staff: (Number(users?.n) || 0) >= 2,
    website: false,
    test_quote: (Number(quotes?.n) || 0) > 0,
  };
  return { checklist: checklist(signals, new Set(marked.map((m) => m.step)), t.slug), slug: t.slug };
}

export async function markStep(tenantId: number, step: string, done: boolean, by: string): Promise<void> {
  if (done) {
    await q(
      `INSERT INTO public.tenant_onboarding (tenant_id, step, done_by) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, step) DO UPDATE SET done_at = now(), done_by = EXCLUDED.done_by`,
      [tenantId, step, by.slice(0, 120)],
    );
  } else {
    await q(`DELETE FROM public.tenant_onboarding WHERE tenant_id = $1 AND step = $2`, [tenantId, step]);
  }
}

/** Fills the empty foam cutting / lamination rates. Returns the keys it set. */
export async function loadStarterFoam(tenantId: number): Promise<string[]> {
  const current = (await getPricingSettings(tenantId)) as unknown as Record<string, unknown>;
  const patch = starterPatch(current, STARTER_FOAM);
  if (Object.keys(patch).length) await updatePricingSettings(patch as Partial<PricingSettings>, tenantId);
  return Object.keys(patch);
}

/** Fills the empty corrugated rates and the default grades' empty $/MSF. Returns what it set. */
export async function loadStarterCorrugated(tenantId: number): Promise<{ rates: string[]; grades: number }> {
  const cfg = await loadCorrugated(tenantId);
  const patch = starterPatch(cfg.settings as unknown as Record<string, unknown>, STARTER_CORRUGATED);
  const gradeFill = new Map(starterGrades(cfg.grades).map((g) => [g.id, g.cost_per_msf]));
  if (!Object.keys(patch).length && !gradeFill.size) return { rates: [], grades: 0 };
  await saveCorrugated(tenantId, {
    settings: { ...cfg.settings, ...patch },
    flutes: cfg.flutes,
    grades: cfg.grades.map((g) => ({
      id: g.id,
      name: g.name,
      flute: g.flute,
      ect_label: g.ect_label,
      cost_per_msf: gradeFill.get(g.id) ?? g.cost_per_msf,
      active: g.active,
      is_default: g.is_default,
    })),
  });
  return { rates: Object.keys(patch), grades: gradeFill.size };
}
