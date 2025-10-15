import { NextResponse } from "next/server";

// HubSpot token introspection: GET /oauth/v1/access-tokens/:token
async function getTokenInfo(token) {
  const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, {
    method: "GET",
    // no Authorization header; token is in the URL for this endpoint
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Token info failed ${res.status}: ${JSON.stringify(data)}`);
  }
  return data; // { hub_id, user, scopes: [...], token_type, expires_in, ... }
}

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok:false, status:500, error:"ADMIN_KEY missing" };
  if (sent !== need) return { ok:false, status:401, error:"Unauthorized" };
  return { ok:true };
}

export async function GET(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json({ ok:false, error: auth.error }, { status: auth.status });

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!token) return NextResponse.json({ ok:false, error:"HUBSPOT_PRIVATE_APP_TOKEN missing" }, { status: 500 });

  try {
    const info = await getTokenInfo(token);
    const scopes = info.scopes || [];
    // simple capability map you can use elsewhere
    const can = {
      conversations: scopes.includes("conversations.read") && scopes.includes("conversations.write"),
      filesWrite: scopes.includes("files.write") || scopes.includes("files.ui_hidden.write"),
      productsRead: scopes.includes("crm.objects.products.read"),
      lineItemsRead: scopes.includes("crm.objects.line_items.read"),
      lineItemsWrite: scopes.includes("crm.objects.line_items.write"),
      dealsWrite: scopes.includes("crm.objects.deals.write"),
      quotesRead: scopes.includes("crm.objects.quotes.read"),
      quotesWrite: scopes.includes("crm.objects.quotes.write"),
      contactsRead: scopes.includes("crm.objects.contacts.read"),
      companiesRead: scopes.includes("crm.objects.companies.read"),
      notesWrite: scopes.includes("crm.objects.notes.write"),
      tasksWrite: scopes.includes("crm.objects.tasks.write"),
      ticketsWrite: scopes.includes("tickets.write"),
    };
    return NextResponse.json({ ok:true, hubId: info.hub_id ?? null, scopes, can });
  } catch (e) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
