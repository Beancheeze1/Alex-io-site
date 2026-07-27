// app/embed/chat/page.tsx
//
// Chrome-free, embeddable chat widget — corner-pinned bubble that expands
// in-place into the quote form. Same Host-header/subdomain tenant
// resolution as every other /embed/* route (NOT the /t/[tenant] path-param
// mechanism the non-embedded landing chat currently piggybacks on).
//
// Gated server-side on the tenant's existing landingChatEnabled opt-in
// (set today only via the owner-only /admin/tenants page) — a tenant that
// hasn't opted in gets nothing rendered, regardless of whether a snippet
// was pasted somewhere.

import { headers } from "next/headers";
import { resolveTenantFromHost } from "@/lib/tenant";
import EmbedChatClient from "@/components/embed/EmbedChatClient";
import EmbedChatDisabled from "@/components/embed/EmbedChatDisabled";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmbedChatPage() {
  const h = await headers();
  const tenant = await resolveTenantFromHost(h.get("host"));
  const chatEnabled = tenant?.theme_json?.landingChatEnabled === true;

  if (!chatEnabled) {
    return <EmbedChatDisabled />;
  }

  return <EmbedChatClient />;
}
