// app/api/admin/tenants/route.ts
//
// Admin-only tenant management.
// GET  -> list tenants
// POST -> create tenant
//
// Tenant writes are OWNER-ONLY via email allowlist.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { q, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(error: string, message?: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>([
  "25thhourdesign@gmail.com",
"25thhourdesign+default@gmail.com",
  "25thhourdesign+acme@gmail.com",
  "25thhourdesign+mline@gmail.com"]);

function canWriteTenants(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(email);
}

// Deterministic admin email strategy (global-unique users.email):
//   25thhourdesign+<tenant_slug>@gmail.com
const TENANT_ADMIN_EMAIL_BASE = "25thhourdesign";
const TENANT_ADMIN_EMAIL_DOMAIN = "gmail.com";

function adminEmailForSlug(slug: string): string {
  const s = String(slug || "").trim().toLowerCase();
  return `${TENANT_ADMIN_EMAIL_BASE}+${s}@${TENANT_ADMIN_EMAIL_DOMAIN}`;
}

function makeTempPassword(): string {
  // 20 chars, URL-safe, high entropy.
  return crypto.randomBytes(24).toString("base64url").slice(0, 20);
}

// -----------------------------
// Brand pull (best-effort)
// Domain-only input (e.g. "acme.com") -> "https://acme.com/"
// Pull:
// - primaryColor: <meta name="theme-color" content="...">
// - logoUrl: <meta property="og:image" content="..."> else <link rel~="icon" href="...">
// Secondary:
// - simple darken of hex primary if possible, else empty
// Fail-open: returns {} on any error.
// -----------------------------

function normalizeDomainToBaseUrl(domainRaw: any): string | null {
  const d = String(domainRaw || "").trim();
  if (!d) return null;

  // Remove protocol if user pasted it anyway (domain-only contract)
  const stripped = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();

  // Very light sanity check: must contain at least one dot, and no spaces
  if (!stripped || /\s/.test(stripped) || !stripped.includes(".")) return null;

  // Force https (best default). If their site is http-only, we fail-open.
  return `https://${stripped}/`;
}

function extractMetaThemeColor(html: string): string {
  // <meta name="theme-color" content="#0ea5e9">
  const re = /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["'][^>]*>/i;
  const m = html.match(re);
  return m?.[1] ? String(m[1]).trim() : "";
}

function extractOgImage(html: string): string {
  // <meta property="og:image" content="https://...">
  const re = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i;
  const m = html.match(re);
  return m?.[1] ? String(m[1]).trim() : "";
}

function extractIconHref(html: string): string {
  // <link rel="icon" href="/favicon.ico"> (also allow rel contains "icon")
  const re = /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i;
  const m = html.match(re);
  return m?.[1] ? String(m[1]).trim() : "";
}

function resolveUrl(maybeRelative: string, baseUrl: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return "";
  }
}

function darkenHex(hex: string, amt: number): string {
  // amt: 0..1, higher = darker
  const s = String(hex || "").trim();
  const m = s.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;

  const f = (v: number) => {
    const x = Math.max(0, Math.min(255, Math.round(v * (1 - amt))));
    return x;
  };

  const rr = f(r).toString(16).padStart(2, "0");
  const gg = f(g).toString(16).padStart(2, "0");
  const bb = f(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

async function pullBrandFromDomain(domainRaw: any): Promise<{
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
}> {
  const baseUrl = normalizeDomainToBaseUrl(domainRaw);
  if (!baseUrl) return {};

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);

  try {
    const res = await fetch(baseUrl, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        // Some sites block empty/default UAs.
        "User-Agent": "Alex-IO Tenant Setup (brand pull)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok) return {};
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return {};
    }

    const html = await res.text();

    const primary = extractMetaThemeColor(html);
    const ogImage = extractOgImage(html);
    const iconHref = extractIconHref(html);

    const logoCandidate = ogImage || iconHref;
    const logoUrl = logoCandidate ? resolveUrl(logoCandidate, baseUrl) : "";

    const secondary = primary ? darkenHex(primary, 0.25) : "";

    return {
      primaryColor: primary || undefined,
      secondaryColor: secondary || undefined,
      logoUrl: logoUrl || undefined,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

  // Hide inactive tenants from the list (non-destructive).
  const tenants = await q(`
    select id, name, slug, active, theme_json, created_at
    from tenants
    where active = true
    order by id asc
  `);

  return ok({ ok: true, tenants });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

  // OWNER ONLY — no one else can create tenants
  if (!canWriteTenants(user)) {
    return bad("forbidden", "Tenant changes are restricted.", 403);
  }

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const slug = body?.slug?.trim()?.toLowerCase();
  const domain = body?.domain; // domain-only (e.g. acme.com)

  if (!name || !slug) {
    return bad("invalid_input", "name and slug required");
  }

  const admin_email = adminEmailForSlug(slug);
  const temp_password = makeTempPassword();

  // Best-effort brand pull (fail-open)
  const brand = await pullBrandFromDomain(domain);

  // Seed minimal theme_json (only fields we support today)
  const theme_json: any = {};
  if (typeof name === "string" && name.trim()) theme_json.brandName = name.trim();
  if (typeof brand.primaryColor === "string" && brand.primaryColor.trim())
    theme_json.primaryColor = brand.primaryColor.trim();
  if (typeof brand.secondaryColor === "string" && brand.secondaryColor.trim())
    theme_json.secondaryColor = brand.secondaryColor.trim();
  if (typeof brand.logoUrl === "string" && brand.logoUrl.trim())
    theme_json.logoUrl = brand.logoUrl.trim();

  try {
    const result = await withTxn(async (tx) => {
      const tRes = await tx.query(
        `
        insert into tenants (name, slug, theme_json)
        values ($1, $2, $3::jsonb)
        returning id, name, slug, active, theme_json, created_at
        `,
        [name, slug, JSON.stringify(theme_json)],
      );

      const tenant = tRes.rows?.[0];
      if (!tenant) throw new Error("Tenant insert returned no row.");

      const password_hash = await bcrypt.hash(temp_password, 10);

      // Seed a per-tenant admin user (email is globally unique due to +<slug> aliasing)
      await tx.query(
        `
        insert into users (email, name, role, tenant_id, password_hash)
        values ($1, $2, 'admin', $3, $4)
        `,
        [admin_email, `${name} Admin`, tenant.id, password_hash],
      );

      return { tenant };
    });

    // Return temp password ONCE (owner-only endpoint). UI should show it immediately.
    return ok({
      ok: true,
      tenant: result.tenant,
      admin_email,
      temp_password,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const low = msg.toLowerCase();

    // Friendly conflicts
    if (low.includes("unique") || low.includes("duplicate key")) {
      if (low.includes("tenants") && low.includes("slug")) {
        return bad("slug_taken", "That tenant slug already exists.", 409);
      }
      if (low.includes("users") && low.includes("email")) {
        return bad(
          "admin_email_taken",
          `Admin email already exists: ${admin_email}. Pick a different slug.`,
          409,
        );
      }
      return bad(
        "conflict",
        "Conflict creating tenant. Slug or admin email may already exist.",
        409,
      );
    }

    return bad("create_failed", msg, 500);
  }
}