// app/api/ai/orchestrate/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function baseUrl() {
  // Prefer your public base; fallback to Render service URL if you keep one in env
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "https://api.alex-io.com"
  ).replace(/\/+$/, "");
}

type OrchestrateInput = {
  toEmail: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  dryRun?: boolean;
};

async function postJsonAbs(url: string, body: unknown, opts: RequestInit = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10_000); // 10s hard timeout
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: ctrl.signal,
      ...opts,
    });
    return res;
  } finally {
    clearTimeout(to);
  }
}

export async function POST(req: Request) {
  try {
    // Ensure these exist (orchestrator may look up signature/templates later)
    requireEnv("MS_TENANT_ID");
    requireEnv("MS_CLIENT_ID");
    requireEnv("MS_CLIENT_SECRET");
    requireEnv("MS_MAILBOX_FROM");

    const input = (await req.json()) as OrchestrateInput;

    const toEmail = input.toEmail?.trim();
    if (!toEmail) return NextResponse.json({ ok: false, error: "missing_toEmail" }, { status: 400 });

    const subject = input.subject?.trim() || "[Alex-IO]";
    const text = input.text?.trim();
    const html = input.html?.trim();
    const dryRun = Boolean(input.dryRun);

    // Compose the mail payload that our /api/msgraph/send already knows how to accept
    const sendBody = {
      to: toEmail,
      subject,
      text,
      html,
      dryRun, // /api/msgraph/send honors dryRun
    };

    // IMPORTANT: absolute URL for internal hop
    const url = `${baseUrl()}/api/msgraph/send?t=${Date.now()}`;
    const res = await postJsonAbs(url, sendBody);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "msgraph_send_failed", status: res.status, detail },
        { status: 502 },
      );
    }

    const graph = await res.json().catch(() => ({}));
    return NextResponse.json({
      ok: true,
      dryRun,
      toEmail,
      subject,
      ms: 4,
      method: "msgraph/send",
      graph,
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    return NextResponse.json({ ok: false, error: "orchestrate_failed", detail }, { status: 500 });
  }
}
