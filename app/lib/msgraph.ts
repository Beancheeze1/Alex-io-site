// app/lib/msgraph.ts
export type SendArgs = {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  dryRun?: boolean;
};

export async function callMsGraphSend(args: SendArgs) {
  const { to, subject, text, inReplyTo, dryRun } = args;

  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const res = await fetch(`${base}/api/msgraph/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ to, subject, text, inReplyTo, dryRun }),
  });

  const details = await res.json().catch(() => ({}));
  return { status: res.status, details };
}
