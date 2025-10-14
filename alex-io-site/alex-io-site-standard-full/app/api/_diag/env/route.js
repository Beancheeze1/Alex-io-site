export async function GET() {
  return new Response(JSON.stringify({
    ok: true,
    hasToken: Boolean(process.env.HUBSPOT_ACCESS_TOKEN),
    autoComment: String(process.env.AUTO_COMMENT || "false")
  }), { headers: { "Content-Type": "application/json" }, status: 200 });
}

