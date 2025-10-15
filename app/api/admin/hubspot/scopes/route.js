// app/api/admin/hubspot/scopes/route.js
import { NextResponse } from "next/server";

// HubSpot token introspection: GET /oauth/v1/access-tokens/:token
async function getTokenInfo(token) {
  const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, {
    method: "GET",
    cache: "no-store",
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Token info failed ${r.status}: ${JSON.stringify(data)}`);
  return data;
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
    const has = (s) => scopes.includes(s);
    const can = {
      conversations: has("conversations.read") && has("conversations.write"),
      filesWrite: has("files.write") || has("files.ui_hidden.write"),
      productsRead: has("crm.objects.products.read"),
      lineItemsRead: has("crm.objects.line_items.read"),
      lineItemsWrite: has("crm.objects.line_items.write"),
      dealsWrite: has("crm.objects.deals.write"),
      quotesRead: has("crm.objects.quotes.read"),
      quotesWrite: has("crm.objects.quotes.write"),
      contactsRead: has("crm.objects.contacts.read"),
      companiesRead: has("crm.objects.companies.read"),
      notesWrite: has("crm.objects.notes.write"),
      tasksWrite: has("crm.objects.tasks.write"),
      ticketsWrite: has("tickets.write"),
    };
    const quotingMode =
      can.quotesWrite && can.quotesRead && can.productsRead &&
      can.lineItemsRead && can.lineItemsWrite && can.dealsWrite
        ? "native"
        : (can.filesWrite ? "pdf" : "text-only");

    return NextResponse.json({ ok:true, hubId: info.hub_id ?? null, scopes, can, quotingMode });
  } catch (e) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
