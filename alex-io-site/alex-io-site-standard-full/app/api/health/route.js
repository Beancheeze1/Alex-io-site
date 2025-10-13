// app/api/health/route.js
export async function GET() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

