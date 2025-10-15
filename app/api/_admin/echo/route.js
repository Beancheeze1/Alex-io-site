// app/api/_admin/echo/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET(req) {
  const url = new URL(req.url);
  const qp = Object.fromEntries(url.searchParams.entries());
  console.log("[ECHO][GET]", { path: url.pathname, qp });
  return NextResponse.json({ method: "GET", path: url.pathname, query: qp });
}

export async function POST(req) {
  const url = new URL(req.url);
  const qp = Object.fromEntries(url.searchParams.entries());
  let json = null;
  try { json = await req.json(); } catch {}
  console.log("[ECHO][POST]", { path: url.pathname, qp, json });
  return NextResponse.json({ method: "POST", path: url.pathname, query: qp, body: json });
}
