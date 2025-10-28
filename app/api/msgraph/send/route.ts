// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token error ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.access_token as string;
}

/**
 * GET — health check
 */
export async function GET() {
  try {
    const tenant = process.env.MS_TENANT_ID;
    const client = process.env.MS_CLIENT_ID;
    const mailbox = process.env.MS_MAILBOX_FROM;

    if (!tenant || !client || !mailbox) {
      return NextResponse.json(
        { ok: false, error: "Missing Graph environment variables." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Graph send route active",
      tenant,
      client,
      mailbox,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST — send a test email via Graph (app-only)
 * Body JSON:
 * {
 *   "to": "you@domain.com"        // optional, defaults to MS_MAILBOX_FROM
 *   "subject": "Test",
 *   "html": "<p>Hello</p>",
 *   "dryRun": true                 // optional; if true, does not send
 * }
 */
export async function POST(req: Request) {
  try {
    const mailbox = requireEnv("MS_MAILBOX_FROM");
    const { to, subject, html, dryRun } = await req.json().catch(() => ({}));

const toAddress = (to as string) || mailbox;
const emailSubject =
  (subject as string) ||
  "Alex-IO Graph Warm-Up — loop-tagged (X-AlexIO-Sent: 1)";

// 🔒 Hidden body marker for loop protection (works even if headers get lost)
const loopMarker = "<!-- alexio:sent=1 -->";

// Start with caller-provided HTML or our default
const baseHtml =
  (html as string) ||
  `<p>Warm-up ping from Alex-IO.</p><p>Timestamp: ${new Date().toISOString()}</p>`;

// Ensure the marker is present exactly once
const htmlWithMarker = baseHtml.includes("alexio:sent=1")
  ? baseHtml
  : `${baseHtml}${loopMarker}`;

// Build the message we would send
const messagePayload = {
  message: {
    subject: emailSubject,
    body: { contentType: "HTML", content: htmlWithMarker }, // ⬅️ use marked HTML
    toRecipients: [{ emailAddress: { address: toAddress } }],
    // 🔒 Header-based loop protection as well
    internetMessageHeaders: [{ name: "X-AlexIO-Sent", value: "1" }],
  },
  saveToSentItems: true,
};



    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        preview: { to: toAddress, subject: emailSubject },
      });
    }

    const token = await getAppToken();

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        mailbox
      )}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { ok: false, status: res.status, error: text },
        { status: 502 }
      );
    }

    // Graph returns 202 for sendMail (no JSON body)
    const requestId = res.headers.get("request-id") || undefined;
    return NextResponse.json({
      ok: true,
      sent: { to: toAddress, subject: emailSubject },
      graph: { status: res.status, requestId },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
