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
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}

export async function GET(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json({ ok:false, error: auth.error }, { status: auth.status });

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!token) return NextResponse.json({ ok:false, error:"HUBSPOT_PRIVATE_APP_TOKEN missing" }, { status: 500 });

  // 1) Try token info (works for OAuth; may not for Private Apps)
  let hubId = null;
  let scopes = null;
  try {
    const infoRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, { cache: "no-store" });
    if (infoRes.ok) {
      const info = await infoRes.json();
      hubId = info?.hub_id ?? null;
      scopes = info?.scopes ?? null; // may be null for Private Apps
    }
  } catch {}

  // 2) Capability probes (read-only; no mutations)
  const results = await Promise.all([
    hs("/crm/v3/owners?limit=1", token),                           // baseline auth
    hs("/crm/v3/objects/products?limit=1", token),                 // products.read
    hs("/crm/v3/objects/line_items?limit=1", token),               // line_items.read
    hs("/crm/v3/objects/deals?limit=1", token),                    // deals.read
    hs("/crm/v3/objects/contacts?limit=1", token),                 // contacts.read
    hs("/crm/v3/objects/companies?limit=1", token),                // companies.read
    hs("/conversations/v3/conversations/threads?limit=1", token),  // conversations.read (inbox)
    hs("/files/v3/files?limit=1", token),                          // files.read
  ]);

  const [owners, products, lineItems, dealsR, contacts, companies, conv, filesR] = results;

  const can = {
    conversationsRead: conv.ok,
    filesRead: filesR.ok,
    productsRead: products.ok,
    lineItemsRead: lineItems.ok,
    dealsRead: dealsR.ok,
    contactsRead: contacts.ok,
    companiesRead: companies.ok,
    // write scopes can’t be safely probed without mutating; infer as false unless introspection provided scopes
    conversationsWrite: scopes ? scopes.includes("conversations.write") : false,
    filesWrite: scopes ? (scopes.includes("files.write") || scopes.includes("files.ui_hidden.write")) : false,
    lineItemsWrite: scopes ? scopes.includes("crm.objects.line_items.write") : false,
    dealsWrite: scopes ? scopes.includes("crm.objects.deals.write") : false,
    quotesRead: scopes ? scopes.includes("crm.objects.quotes.read") : false,
    quotesWrite: scopes ? scopes.includes("crm.objects.quotes.write") : false,
    notesWrite: scopes ? scopes.includes("crm.objects.notes.write") : false,
    tasksWrite: scopes ? scopes.includes("crm.objects.tasks.write") : false,
  };

  // decide quoting mode
  const quotingMode =
    (can.quotesRead && can.quotesWrite && can.productsRead && can.lineItemsRead && can.lineItemsWrite && can.dealsWrite)
      ? "native"
      : (can.filesRead || can.filesWrite ? "pdf" : "text-only");

  return NextResponse.json({
    ok: true,
    hubId,
    probes: {
      owners: owners.status,
      products: products.status,
      lineItems: lineItems.status,
      deals: dealsR.status,
      contacts: contacts.status,
      companies: companies.status,
      conversations: conv.status,
      files: filesR.status,
    },
    scopes: scopes || null,   // may be null for Private App
    can,
    quotingMode,
  });
}
