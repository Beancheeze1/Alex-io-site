// app/api/hubspot/scopes/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Temporary shim: report a safe, static list so the page builds */
export async function GET() {
  const scopes = [
    "crm.objects.contacts.read",
    "crm.objects.contacts.write",
    "crm.objects.owners.read",
  ];
  return NextResponse.json({ ok: true, scopes, note: "shim" }, { status: 200 });
}
