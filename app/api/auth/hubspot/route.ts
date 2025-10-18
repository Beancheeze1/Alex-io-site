import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client_id = process.env.HUBSPOT_CLIENT_ID;
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI;
  if (!client_id || !redirect_uri) {
    return NextResponse.json({ ok: false, error: "missing_env" }, { status: 500 });
  }

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
    // "files",
    // "files.ui_hidden.read",
    // "forms-uploaded-files"
  ].join(" ");

  const u = new URL("https://app.hubspot.com/oauth/authorize");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirect_uri);
  u.searchParams.set("scope", scopes);

  // You can redirect instead of JSON if you prefer:
  // return NextResponse.redirect(u.toString());

  return NextResponse.json({ ok: true, url: u.toString() }, { status: 200 });
}
