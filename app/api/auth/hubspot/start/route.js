import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  const cid = process.env.HUBSPOT_CLIENT_ID;
  const redirect = process.env.HUBSPOT_REDIRECT_URI;
  const scopes = [
    "oauth",
    "files",
    "conversations.read","conversations.write",
    "crm.objects.products.read",
    "crm.objects.line_items.read","crm.objects.line_items.write",
    "crm.objects.contacts.read","crm.objects.contacts.write",
    "crm.objects.companies.read","crm.objects.companies.write",
    "crm.objects.deals.read","crm.objects.deals.write",
    "crm.objects.quotes.read","crm.objects.quotes.write",
    "crm.objects.owners.read",
    "crm.schemas.custom.read",
  ].join(" ");
  const state = Math.random().toString(36).slice(2);
  const url = new URL("https://app.hubspot.com/oauth/authorize");
  url.searchParams.set("client_id", cid);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString(), { status: 302 });
}
