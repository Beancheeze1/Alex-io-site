import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

const ALLOWED_EVENTS = new Set([
  "page_view",
  "scroll_50",
  "cta_click",
  "form_start",
  "form_submit",
  "sample_editor",      // clicked "Play around in the editor"
  "sample_skip",        // clicked "Skip to priced quote"
  "quote_applied",      // handleApplyToQuote succeeded
  "quote_email",        // submitted "email this quote" box
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
  // Email security scanners and link preview bots
  "resend", "mailscanner", "sendgrid", "postmark", "sparkpost",
  "emailchecker", "preview", "safelinks", "urlscan",
  "preview.outreach", "zscaler", "barracuda", "proofpoint",
  "mimecast", "cloudmark",
];

function isBot(userAgent: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some(pattern => ua.includes(pattern));
}

async function getGeoLocation(ip: string): Promise<{ city: string | null; region: string | null }> {
  if (!ip || ip === "unknown" || ip.startsWith("192.168") ||
      ip.startsWith("10.") || ip.startsWith("127.") || ip === "::1") {
    return { city: null, region: null };
  }
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=city,regionName,status`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (!res.ok) return { city: null, region: null };
    const data = await res.json();
    if (data.status !== "success") return { city: null, region: null };
    return { city: data.city || null, region: data.regionName || null };
  } catch {
    return { city: null, region: null };
  }
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

    const { city, region } = await getGeoLocation(ip ?? "");

    // Reject if this session already has a page_view within the last 5 seconds
    // (catches email scanner bots that hit links multiple times simultaneously)
    if (event_type === "page_view") {
      const recent = await q(
        `SELECT id FROM page_events
         WHERE session_id = $1
         AND event_type = 'page_view'
         AND created_at > NOW() - INTERVAL '5 seconds'
         LIMIT 1`,
        [session_id]
      );
      if (recent.length > 0) {
        return NextResponse.json({ ok: true }); // silently deduplicate
      }
    }

    await q(
      `INSERT INTO page_events
         (session_id, event_type, page, referrer, utm_source, utm_medium, utm_campaign, device, ip, city, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        city,
        region,
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
