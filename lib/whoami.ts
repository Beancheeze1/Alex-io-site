import { getAnyToken, listPortals, refreshIfNeeded } from "@/lib/hubspot";

export async function whoamiData() {
  const bundle = await getAnyToken();
  const portals = await listPortals();
  if (!bundle) return { ok: true, hasToken: false, portals };

  const fresh = await refreshIfNeeded(bundle);
  return {
    ok: true,
    hasToken: true,
    hubId: fresh.hubId,
    expires_at: fresh.expires_at,
    portals,
  };
}
