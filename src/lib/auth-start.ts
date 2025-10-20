import { buildAuthUrl, saveState } from "@/lib/hubspot";

export async function getAuthRedirect(origin: string) {
  const { url, state } = buildAuthUrl(origin);
  await saveState(state);
  return `${url}&state=${encodeURIComponent(state)}`;
}
