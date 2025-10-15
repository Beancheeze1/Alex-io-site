// app/api/admin/hubspot/scopes/route.js
import { NextResponse } from "next/server";
import { capabilitiesFromScopes } from "@/lib/capabilities"; // if you don't have @ alias, use "../../../../../lib/capabilities"

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

  // Try (may fail for Private App tokens)
  let hubId = null;
  let scopes = null;
  try {
    const infoRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, { cache: "no-store" });
    if (infoRes.ok) {
      const info = await infoRes.json();
      hubId = info?.hub_id ?? null;
      scopes = info?.scopes ?? null;
    }
  } catch {}

  // Probe safe read endpoints
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

  // Start with capabilities from scopes (if we have them)…
  let caps = scopes ? capabilitiesFromScopes(scopes) : capabilitiesFromScopes([]);

  // …then overlay what we learned from probes (read capabilities)
  const is200 = (x) => x.status >= 200 && x.status < 300;
  caps = {
    ...caps,
    conversationsRead: is200(conv) || caps.conversationsRead,
    filesRead: is200(filesR) || caps.filesRead,
    productsRead: is200(products) || caps.productsRead,
    lineItemsRead: is200(lineItems) || caps.lineItemsRead,
    dealsRead: is200(dealsR) || caps.dealsRead,
    contactsRead: is200(contacts) || caps.contactsRead,
    companiesRead: is200(companies) || caps.companiesRead,
  };

  // Re-compute quoting mode with the merged view
  caps.quotingMode =
    (caps.quotesRead && caps.quotesWrite && caps.productsRead &&
     caps.lineItemsRead && caps.lineItemsWrite && caps.dealsWrite)
      ? "native"
      : (caps.filesWrite || caps.filesRead ? "pdf" : "text-only");

  return NextResponse.json({
    ok: true,
    hubId,
    probes: {
      owners: owners.status, products: products.status, lineItems: lineItems.status,
      deals: dealsR.status, contacts: contacts.status, companies: companies.status,
      conversations: conv.status, files: filesR.status,
    },
    scopes: scopes || null,
    can: caps,
    quotingMode: caps.quotingMode,
  });
}
