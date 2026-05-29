import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

const ALLOWED_EVENTS = new Set([
  "page_view",
  "scroll_50",
  "cta_click",
  "form_start",
  "form_submit",
]);

const BOT_PATTERNS = [
  // Search engine crawlers
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "sogou", "exabot", "facebot", "ia_archiver",
  // Headless browsers and automation
  "headlesschrome", "phantomjs", "selenium", "puppeteer", "playwright",
  "chromium", "lighthouse",
  // Generic bot/crawler signals
  "bot", "crawl", "spider", "scraper", "fetch", "curl", "wget",
  "python-requests", "axios", "node-fetch", "go-http",
  // Monitoring and SEO tools
  "ahrefsbot", "semrushbot", "dotbot", "rogerbot", "mj12bot",
  "uptimerobot", "pingdom", "gtmetrix", "pagespeed",
];

function isBot(userAgent: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some(pattern => ua.includes(pattern));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session_id, event_type, page, referrer, utm_source, utm_medium, utm_campaign, device } = body;

    const userAgent = req.headers.get("user-agent") || "";
    if (isBot(userAgent)) {
      return NextResponse.json({ ok: true }); // silently ignore, don't error
    }

    if (!session_id || !event_type || !ALLOWED_EVENTS.has(event_type)) {
      return NextResponse.json({ ok: false });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    await q(
      `INSERT INTO page_events
         (session_id, event_type, page, referrer, utm_source, utm_medium, utm_campaign, device, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session_id,
        event_type,
        page ?? "/landing",
        referrer ?? null,
        utm_source ?? null,
        utm_medium ?? null,
        utm_campaign ?? null,
        device ?? null,
        ip,
      ],
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
