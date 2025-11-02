// app/api/hubspot/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { splitName } from "@/app/lib/tpl";
export const dynamic = "force-dynamic";

function looksExternal(email: string) { return !email.toLowerCase().endsWith("@alex-io.com"); }
function isEmail(s: unknown): s is string { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function parseEmailFromHeader(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/<\s*([^>]+@[^>]+)\s*>/);
  if (m?.[1] && isEmail(m[1])) return m[1].trim();
  if (isEmail(v.trim())) return v.trim();
  return null;
}
function parseNameFromHeader(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const nameOnly = v.replace(/<[^>]+>/g, "").trim().replace(/^"|"$/g, "");
  return nameOnly || null;
}

async function getAccessToken(selfBase: string) {
  const refreshUrl = `${selfBase}/api/hubspot/refresh`;
  const res = await fetch(refreshUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const j = await res.json();
  return j?.accessToken || j?.access_token || j?.token;
}

async function findContactByEmail(email: string, token: string) {
  try {
    const url = "https://api.hubapi.com/crm/v3/objects/contacts/search";
    const body = {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["firstname", "lastname", "company", "hs_company_name"],
      limit: 1
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) return null;
    const j = await r.json();
    const row = j?.results?.[0];
    if (!row) return null;
    const props = row.properties || {};
    return {
      contactId: row.id,
      firstName: props.firstname || "",
      lastName: props.lastname || "",
      company: props.company || props.hs_company_name || ""
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const selfBase = process.env.INTERNAL_SELF_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const { objectId, messageId } = await req.json() as { objectId?: string | number, messageId?: string };
    if (!objectId) return NextResponse.json({ ok: false, error: "missing objectId" }, { status: 400 });

    const token = await getAccessToken(selfBase);

    // 1) Fetch thread messages
    const hsUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages`;
    const res = await fetch(hsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "hubspot messages fetch failed", status: res.status, details: t.slice(0, 1000) }, { status: 404 });
    }
    const data = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data) ? data : (Array.isArray((data as any)?.results) ? (data as any).results : []);
    let chosen: any = null;
    if (messageId) chosen = items.find(m => String(m?.id) === String(messageId) || String(m?.messageId) === String(messageId)) || null;
    if (!chosen && items.length) chosen = items.find(m => String(m?.direction || "").toLowerCase() === "inbound") || items[items.length - 1];

    // 2) Basic inbox hints
    const hintSrc = chosen || items[0] || {};
    const inboxId = hintSrc?.inboxId ?? hintSrc?.inbox?.id ?? null;
    const channelId = hintSrc?.channelId ?? hintSrc?.channel?.id ?? null;
    const inboxEmail =
      hintSrc?.to?.[0]?.email ||
      hintSrc?.inbox?.email ||
      hintSrc?.channel?.email ||
      null;

    // 3) Sender email + display name
    const headerFrom = chosen?.headers?.["From"] ?? chosen?.headers?.["from"] ?? null;
    const headerReplyTo = chosen?.headers?.["Reply-To"] ?? chosen?.headers?.["reply-to"] ?? null;
    const displayName = parseNameFromHeader(headerFrom) || parseNameFromHeader(headerReplyTo) || chosen?.from?.name || null;

    const candidates: (string | undefined | null)[] = [
      chosen?.from?.email,
      chosen?.sender?.email,
      chosen?.originator?.email,
      parseEmailFromHeader(headerReplyTo),
      parseEmailFromHeader(headerFrom),
    ];
    let email: string | null = null;
    for (const c of candidates) {
      if (c && isEmail(c) && looksExternal(c)) { email = c; break; }
    }
    if (!email) {
      const blob = JSON.stringify(chosen ?? {});
      const deep = [...blob.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(m => m[0].toLowerCase());
      email = deep.find(e => looksExternal(e)) || null;
    }
    if (!email) return NextResponse.json({ ok: false, error: "no_email_found" }, { status: 404 });

    // 4) Try HubSpot Contacts for richer fields
    const contact = await findContactByEmail(email, token);
    const { firstName: name1, lastName: name2 } = splitName(displayName || undefined);
    const firstName = (contact?.firstName || name1 || "").trim();
    const lastName  = (contact?.lastName  || name2 || "").trim();
    const company   = (contact?.company   || "").trim();

    return NextResponse.json({
      ok: true,
      email,
      via: displayName ? "direct+name" : (contact ? "contact_search" : "deep"),
      inboxId, channelId, inboxEmail,
      contact: { contactId: contact?.contactId || null, firstName, lastName, company, displayName: displayName || "" }
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
