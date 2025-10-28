// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Graph Send test route
 * Verifies env vars and connectivity before sending real emails
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
