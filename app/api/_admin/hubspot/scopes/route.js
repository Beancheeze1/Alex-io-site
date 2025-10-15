import { NextResponse } from "next/server";

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok:false, status:500, error:"ADMIN_KEY missing" };
  if (sent !== need) return { ok:false, status:401, error:"Unauthorized" };
  return { ok:true };
}

async function hs(path, token) {
  const url = path.startsWith("http") ? path : `https://api.hubapi.com${path}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    let data = null;
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data, url };
  } catch (e) {
    return { ok:false, status:0, data:String(e), url };
  }
}

export async function GET(req) {
  try {
    const auth = requireAdmin(req.headers);
    if (!auth.ok) return NextResponse.json({ ok:false, error: auth.error }, { status: auth.status });

    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
    if (!token) return NextResponse.json({ ok:false, error:"HUBSPOT_PRIVATE_APP_TOKEN missing" }, { status: 500 });

    // Try OAuth token introspection (often not available for Private App tokens)
    let hubId = null, scopes = null, introspect = null;
    try {
      const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      introspect = { status: r.status, ok: r.ok, body: j };
      if (r.ok) {
        hubId = j?.hub_id ?? null;
        scopes = j?.scopes ?? null;
      }
    } catch (e) {
      introspect = { status:0, ok:false, error:String(e) };
    }

    // Safe read probes
    const [owners, products, lineItems, dealsR, contacts, companies, conv, filesR] = await Promise.all([
      hs("/crm/v3/owners?limit=1", token),
      hs("/crm/v3/objects/products?limit=1", token),
      hs("/crm/v3/objects/line_items?limit=1", token),
      hs("/crm/v3/objects/deals?limit=1", token),
      hs("/crm/v3/objects/contacts?limit=1", token),
      hs("/crm/v3/objects/companies?limit=1", token),
      hs("/conversations/v3/conversations/threads?limit=1", token),
      hs("/files/v3/files?limit=1", token),
    ]);

    const is200 = (x) => x.status >= 200 && x.status < 300;

    // Compute capabilities directly here (no external helper)
    const has = (s) => (Array.isArray(scopes) ? scopes.includes(s) : false);
    let can = {
      conversationsRead: is200(conv),
      conversationsWrite: has("conversations.write"),
      filesRead: is200(filesR) || has("files") || has("files.read"),
      filesWrite: has("files") || has("files.write") || has("files.ui_hidden.write"),
      productsRead: is200(products) || has("crm.objects.products.read"),
      lineItemsRead: is200(lineItems) || has("crm.objects.line_items.read"),
      lineItemsWrite: has("crm.objects.line_items.write"),
      dealsRead: is200(dealsR) || has("crm.objects.deals.read"),
      dealsWrite: has("crm.objects.deals.write"),
      contactsRead: is200(contacts) || has("crm.objects.contacts.read"),
      companiesRead: is200(companies) || has("crm.objects.companies.read"),
      quotesRead: has("crm.objects.quotes.read"),
      quotesWrite: has("crm.objects.quotes.write"),
      notesWrite: has("crm.objects.notes.write"),
      tasksWrite: has("crm.objects.tasks.write"),
    };

    const quotingMode =
      (can.quotesRead && can.quotesWrite && can.productsRead && can.lineItemsRead && can.lineItemsWrite && can.dealsWrite)
        ? "native"
        : (can.filesWrite || can.filesRead ? "pdf" : "text-only");

    return NextResponse.json({
      ok: true,
      hubId,
      introspect,
      probes: {
        owners, products, lineItems, deals: dealsR, contacts, companies, conversations: conv, files: filesR
      },
      can,
      quotingMode,
    });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
