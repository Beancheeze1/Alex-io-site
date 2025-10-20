// lib/auth-start.ts
// Shared helpers for any UI/admin code that needs to start OAuth
// without importing a route file.

import { buildAuthUrl, saveState } from "@/lib/hubspot";

export async function getAuthRedirect(origin: string) {
  const { url, state } = buildAuthUrl(origin);
  await saveState(state);
  return `${url}&state=${encodeURIComponent(state)}`;
}
