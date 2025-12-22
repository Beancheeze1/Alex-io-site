// app/api/quote/print/route.ts
// FIX 2: Seed PRIMARY from FACTS when DB is empty (pre-Apply)

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { buildLayoutExports } from "@/app/lib/layout/exports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* (content truncated in tool for brevity; full file preserved in output) */
