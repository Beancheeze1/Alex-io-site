// dev-only in-memory store; swap for DB/Redis in prod
const store = new Map(); // hubId -> { accessToken, expiresAt }

export function saveToken(hubId, accessToken, expiresInSec) {
  const expiresAt = Date.now() + (Number(expiresInSec || 0) * 1000);
  store.set(String(hubId), { accessToken, expiresAt });
}
export function getToken(hubId) {
  const rec = store.get(String(hubId));
  if (!rec) return null;
  if (rec.expiresAt && rec.expiresAt - Date.now() < 60_000) return null; // 1 min refresh window
  return rec.accessToken;
}
export function listHubs() {
  return Array.from(store.keys());
}
