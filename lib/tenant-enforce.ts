// lib/tenant-enforce.ts
//
// Enforce that the authenticated user's tenant_id matches the tenant resolved
// from the request host (via middleware-injected header x-tenant-slug).
//
// Path A: small, explicit, additive. No middleware DB access.

import type { NextRequest } from "next/server";
import type { CurrentUser } from "@/lib/auth";
import { resolveTenantFromHost } from "@/lib/tenant";

export type TenantEnforceResult =
  | { ok: true; tenant_id: number; tenant_slug: string | null }
  | { ok: false; status: number; body: { ok: false; error: string; message: string } };

export async function enforceTenantMatch(
  req: NextRequest,
  user: CurrentUser | null,
): Promise<TenantEnforceResult> {
  const tenantSlug = req.headers.get("x-tenant-slug");

  // Core host (no tenant slug header) -> no enforcement here.
  if (!tenantSlug) {
    return { ok: true, tenant_id: user?.tenant_id ?? 0, tenant_slug: null };
  }

  // Tenant host requires login.
  if (!user) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: "unauthorized", message: "Login required." },
    };
  }

  // Resolve tenant from host header (safer than trusting just slug text).
  const host = req.headers.get("host");
  const tenant = await resolveTenantFromHost(host);

  if (!tenant) {
    return {
      ok: false,
      status: 404,
      body: { ok: false, error: "tenant_not_found", message: "Tenant not found." },
    };
  }

  if (Number(user.tenant_id) !== Number(tenant.id)) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: "tenant_mismatch", message: "Tenant access denied." },
    };
  }

  return { ok: true, tenant_id: tenant.id, tenant_slug: tenant.slug };
}