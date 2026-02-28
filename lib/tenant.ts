// lib/tenant.ts
//
// Resolves tenant from Host header for A2 pattern:
//   TENANT.api.alex-io.com
// Core host:
//   api.alex-io.com

import { one } from "@/lib/db";

export type ResolvedTenant = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  theme_json: any;
} | null;

export function extractSlugFromHost(host: string | null): string | null {
  if (!host) return null;

  // remove port if present
  const clean = host.split(":")[0].toLowerCase();

  // Core host maps to Default tenant slug
  if (clean === "api.alex-io.com") return "default";

  const parts = clean.split(".");
  if (parts.length < 4) return null;

  // expecting TENANT.api.alex-io.com
  return parts[0] || null;
}

export async function resolveTenantFromHost(
  host: string | null,
): Promise<ResolvedTenant> {
  const slug = extractSlugFromHost(host);
  if (!slug) return null;

  const row = await one<{
    id: number;
    name: string;
    slug: string;
    active: boolean;
    theme_json: any;
  }>(
    `
    select id, name, slug, active, theme_json
    from tenants
    where slug = $1
    `,
    [slug],
  );

  if (!row || !row.active) return null;

  return row;
}
