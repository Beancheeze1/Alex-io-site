// app/api/admin/funnel/route.ts
//
// Step 35: the quote funnel (app/lib/funnel-core.ts) for the admin page.
//   GET ?days=30|90|365&tenant=all|<id>
//     -> { ok, days, scope, shops?, funnel, by_channel, by_rep, by_shop?,
//          cycle, stalled, totals, capped }
//   GET ...&format=csv -> one row per quote (Excel-safe)
// Shop admins see their own shop. The platform owner can pick a shop or
// "all" (the default for the owner), with a per-shop table.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { funnelShops, loadFunnelQuotes } from "@/app/lib/funnel";
import { byChannel, byRep, byShop, cleanDays, cycleTimes, funnel, funnelCsv, stalled } from "@/app/lib/funnel-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin"])) return json({ ok: false, error: "forbidden", message: "Admins only." }, 403);
    const sp = req.nextUrl.searchParams;
    const days = cleanDays(sp.get("days"));
    const owner = isPlatformOwner(user);
    const own = Number(user.tenant_id);

    let tenantId: number | null = own;
    if (owner) {
      const t = sp.get("tenant");
      if (!t || t === "all") tenantId = null;
      else if (/^\d+$/.test(t)) tenantId = Number(t);
      else return json({ ok: false, error: "invalid_tenant", message: "tenant must be all or a shop id." }, 400);
    }

    const { quotes, capped } = await loadFunnelQuotes({ tenantId, days });

    if (sp.get("format") === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(funnelCsv(quotes), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="quote-funnel_${tenantId == null ? "all-shops" : `shop-${tenantId}`}_${days}d_${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const now = new Date();
    return json({
      ok: true,
      days,
      scope: { tenant: tenantId == null ? "all" : tenantId, owner },
      ...(owner ? { shops: await funnelShops() } : {}),
      funnel: funnel(quotes),
      by_channel: byChannel(quotes),
      by_rep: byRep(quotes),
      ...(tenantId == null ? { by_shop: byShop(quotes) } : {}),
      cycle: cycleTimes(quotes),
      stalled: stalled(quotes, now).slice(0, 50),
      totals: {
        quotes: quotes.length,
        emailed: quotes.filter((x) => x.emailed).length,
        reorders: quotes.filter((x) => !!x.reorder_of).length,
      },
      capped,
    });
  } catch (e) {
    console.error("[admin/funnel] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the funnel." }, 500);
  }
}
