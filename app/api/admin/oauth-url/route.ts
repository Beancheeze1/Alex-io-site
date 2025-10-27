// app/api/admin/oauth-url/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  if (!base || !clientId) {
    return NextResponse.json({ ok:false, error:"missing_base_or_client_id", base, clientId: !!clientId }, { status: 400 });
  }
  const redirect = `${base.replace(/\/$/,"")}/api/auth/hubspot/callback`;
  const scopes = "oauth conversations.read conversations.write crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read files";
  const enc = (s:string) => encodeURIComponent(s);
  const url = `https://app.hubspot.com/oauth/authorize?client_id=${enc(clientId)}&redirect_uri=${enc(redirect)}&scope=${enc(scopes)}`;
  return NextResponse.json({ ok:true, clientId, redirect, scopes, url });
}
