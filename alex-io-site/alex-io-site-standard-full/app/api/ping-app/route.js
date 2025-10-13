export async function GET() {
  return new Response(JSON.stringify({ ok: true, from: "app-router" }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

