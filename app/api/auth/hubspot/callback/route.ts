import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Force module mode for TS no matter what tries to import. */
export {}; // <-- harmless, guarantees this file is a module

type EnvCheck = { ok: boolean; error?: string; have?: { client_id: boolean; redirect_uri: boolean } };

function buildAuthorizeUrl(): { ok: true; url: string } | EnvCheck {
  const client_id = process.env.HUBSPOT_CLIENT_ID ?? "";
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI ?? "";

  if (!client_id || !redirect_uri) {
    return {
      ok: false,
      error: "missing_env",
      have: { client_id: !!client_id, redirect_uri: !!redirect_uri },
    };
  }

  // Canonical scopes (space-separated). No 'files.read'.
  const scopes = [
    "oauth",
    "crm.objects.contacts.read",
    "crm.objects.contacts.write",
    "crm.objects.companies.read",
    "crm.objects.companies.write",
    "crm.objects.deals.read",
    "crm.objects.deals.write",
    "crm.objects.owners.read",
    "conversations.read",
    "conversations.write",
    // "files",
    // "files.ui_hidden.read",
    // "forms-uploaded-files",
  ].join(" ");

  const u = new URL("https://app.hubspot.com/oauth/authorize");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirect_uri);
  u.searchParams.set("scope", scopes);

  return { ok: true, url: u.toString() };
}

export async function GET() {
  const result = buildAuthorizeUrl();
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result, { status: 200 });
}
