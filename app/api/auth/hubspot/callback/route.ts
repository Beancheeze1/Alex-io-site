import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Builds a HubSpot authorize URL using the canonical scopes.
 * Returns JSON { ok, url } so you can click through or redirect from the UI.
 */
export async function GET() {
  const client_id = process.env.HUBSPOT_CLIENT_ID ?? "";
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI ?? "";

  if (!client_id || !redirect_uri) {
    return NextResponse.json(
      { ok: false, error: "missing_env", have: { client_id: !!client_id, redirect_uri: !!redirect_uri } },
      { status: 500 }
    );
  }

  // Canonical scopes (space-separated). Do NOT use `files.read` (invalid).
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
    "conversations.write"
    // "files",                 // enable if you truly need File Manager
    // "files.ui_hidden.read", // enable if you need hidden/system files
    // "forms-uploaded-files"
  ].join(" ");

  const u = new URL("https://app.hubspot.com/oauth/authorize");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirect_uri);
  u.searchParams.set("scope", scopes);

  return NextResponse.json({ ok: true, url: u.toString() }, { status: 200 });
}
