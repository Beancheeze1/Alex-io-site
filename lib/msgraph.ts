// app/lib/msgraph.ts
//
// Thin internal client for our own /api/msgraph/send route.

import { internalHeaders } from "@/lib/internal-call";

export type SendArgs = {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  dryRun?: boolean;
};

export async function callMsGraphSend(args: SendArgs) {
  const { to, subject, text, inReplyTo, dryRun } = args;

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/msgraph/send`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalHeaders() },
    body: JSON.stringify({ to, subject, text, inReplyTo, dryRun }),
    // Avoid Next.js caching for server-to-server call
    cache: "no-store",
  });

  const details = await res.json().catch(() => ({}));
  return { status: res.status, details };
}
