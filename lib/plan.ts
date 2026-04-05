// lib/plan.ts
//
// Single source of truth for Alex-IO subscription tier gating.
//
// Plans:
//   starter  $599/mo   2 seats   PDF only · layout editor · email parsing
//   pro      $1199/mo  10 seats  + CAD/DXF/STEP · HubSpot · commissions
//   shop     $1999/mo  unlimited + Multi-location · white-label · API
//
// Usage:
//   const plan = await getPlanForTenant(tenantId);
//   await requirePlan(tenantId, "pro");          // throws PlanGateError if starter
//   const limit = PLAN_LIMITS[plan].seats;       // 2 | 10 | Infinity
//
// All gate checks are additive — existing routes are not modified,
// only new calls to requirePlan() are inserted at the gate points.

import { one } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Plan = "starter" | "pro" | "shop";

export type PlanLimits = {
  seats: number;           // max users per tenant (Infinity = unlimited)
  cadExports: boolean;     // DXF / STEP / 3-view PDF exports
  hubspot: boolean;        // HubSpot CRM sync
  commissions: boolean;    // Commission tracking module
  multiTenant: boolean;    // Can create additional tenants (Shop only)
  whiteLabel: boolean;     // Custom branding / white-label
  api: boolean;            // API access
};

// ── Plan definitions ──────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    seats: 2,
    cadExports: false,
    hubspot: false,
    commissions: false,
    multiTenant: false,
    whiteLabel: false,
    api: false,
  },
  pro: {
    seats: 10,
    cadExports: true,
    hubspot: true,
    commissions: true,
    multiTenant: false,
    whiteLabel: false,
    api: false,
  },
  shop: {
    seats: Infinity,
    cadExports: true,
    hubspot: true,
    commissions: true,
    multiTenant: true,
    whiteLabel: true,
    api: true,
  },
};

// Plan hierarchy for comparison
const PLAN_RANK: Record<Plan, number> = {
  starter: 0,
  pro: 1,
  shop: 2,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePlan(raw: string | null | undefined): Plan {
  const p = String(raw ?? "").trim().toLowerCase();
  if (p === "starter" || p === "pro" || p === "shop") return p;
  // Default to pro so any misconfigured tenant retains full access
  return "pro";
}

// ── Error class ───────────────────────────────────────────────────────────────

export class PlanGateError extends Error {
  public readonly currentPlan: Plan;
  public readonly requiredPlan: Plan;
  public readonly feature: string;
  public readonly upgradeMessage: string;

  constructor(opts: {
    currentPlan: Plan;
    requiredPlan: Plan;
    feature: string;
  }) {
    const { currentPlan, requiredPlan, feature } = opts;
    const upgradeMessage =
      `This feature requires the ${requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)} plan. ` +
      `Your current plan is ${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}. ` +
      `Contact us to upgrade.`;

    super(upgradeMessage);
    this.name = "PlanGateError";
    this.currentPlan = currentPlan;
    this.requiredPlan = requiredPlan;
    this.feature = feature;
    this.upgradeMessage = upgradeMessage;
  }
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Fetch the plan for a tenant from the DB.
 * Falls back to 'pro' if the tenant is not found or has no plan set,
 * so existing tenants always retain full access.
 */
export async function getPlanForTenant(tenantId: number): Promise<Plan> {
  try {
    const row = await one<{ plan: string | null }>(
      `SELECT plan FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return normalizePlan(row?.plan);
  } catch {
    // Non-fatal: if plan column doesn't exist yet (migration pending), default to pro
    return "pro";
  }
}

/**
 * Check whether a tenant's plan meets the minimum required tier.
 * Returns true if plan >= minPlan, false otherwise.
 */
export function planMeets(current: Plan, minPlan: Plan): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[minPlan];
}

/**
 * Throws a PlanGateError if the tenant's plan is below the required tier.
 * Use this at the top of any gated API route handler.
 *
 * @example
 *   await requirePlan(user.tenant_id, "pro", "CAD exports");
 */
export async function requirePlan(
  tenantId: number,
  minPlan: Plan,
  feature = "This feature",
): Promise<Plan> {
  const current = await getPlanForTenant(tenantId);
  if (!planMeets(current, minPlan)) {
    throw new PlanGateError({ currentPlan: current, requiredPlan: minPlan, feature });
  }
  return current;
}

/**
 * Count active users for a tenant and check against the plan seat limit.
 * Returns { allowed: boolean, current: number, limit: number, plan }.
 * Does NOT throw — caller decides how to handle the response.
 */
export async function checkSeatLimit(tenantId: number): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  plan: Plan;
}> {
  const plan = await getPlanForTenant(tenantId);
  const limit = PLAN_LIMITS[plan].seats;

  const row = await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.users WHERE tenant_id = $1`,
    [tenantId],
  );
  const current = row?.c ?? 0;

  return {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
}

/**
 * Build a standard 402 Plan Gate JSON response body.
 * Use this in catch blocks when a PlanGateError is thrown.
 */
export function planGateResponse(err: PlanGateError) {
  return {
    ok: false,
    error: "PLAN_GATE",
    currentPlan: err.currentPlan,
    requiredPlan: err.requiredPlan,
    feature: err.feature,
    message: err.upgradeMessage,
  };
}
