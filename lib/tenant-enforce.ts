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
  | { ok: true; tenant_id: number; tenant_slug: string | null; isPublic?: boolean }
  | { ok: false; status: number; body: { ok: false; error: string; message: string } };

export type TenantEnforceOptions = {
  /**
   * When true, unauthenticated requests are allowed as long as the tenant
   * can be resolved from the request host. Used for public-facing widget
   * flows (customer form → AI chat → layout editor) where no login exists.
   */
  allowPublic?: boolean;
};

export async function enforceTenantMatch(
  req: NextRequest,
  user: CurrentUser | null,
  options?: TenantEnforceOptions,
): Promise<TenantEnforceResult> {
  const tenantSlug = req.headers.get("x-tenant-slug");

  // Core host (no tenant slug header) -> no enforcement here.
  if (!tenantSlug) {
    return { ok: true, tenant_id: user?.tenant_id ?? 0, tenant_slug: null };
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

  // Public widget flow: no user but caller opted in to allowing public access.
  // The tenant is still resolved and scoped from the host — not caller-supplied.
  if (!user && options?.allowPublic) {
    return { ok: true, tenant_id: tenant.id, tenant_slug: tenant.slug, isPublic: true };
  }

  // Tenant host requires login.
  if (!user) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: "unauthorized", message: "Login required." },
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