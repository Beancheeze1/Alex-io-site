// lib/kv.impl.js
/**
 * Simple Upstash REST ping used by /api/admin/test.
 * Requires:
 *  - UPSTASH_REDIS_REST_URL
 *  - UPSTASH_REDIS_REST_TOKEN
 */
export async function kvPing() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('Upstash env missing (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)');
  }

  const res = await fetch(`${url}/GET/ping`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  }

  // Upstash returns "null" for GET/ping; surface whatever it returns.
  return res.text();
}
