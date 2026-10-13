// lib/box-edit-guard.ts
//
// Step 14: who may add, swap or remove boxes on a saved quote
// (/api/boxes/add-to-quote, /add-custom-to-quote, /remove-from-quote).
//   - Staff (admin / cs / sales) of the quote's shop, or the platform owner:
//     always, including released quotes.
//   - Everyone else (the buyer's own editor and quote page): rate-limited,
//     and refused once the quote is released (locked).
// Returns a response to send back, or null when the change may go ahead.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function boxEditGuard(
  req: NextRequest,
  quote: { tenant_id: number | string | null; locked?: boolean | null },
): Promise<NextResponse | null> {
  const user = await getCurrentUserFromRequest(req).catch(() => null);
  const isShopStaff =
    !!user &&
    isRoleAllowed(user, ["admin", "cs", "sales"]) &&
    (Number(user.tenant_id) === Number(quote.tenant_id) || isPlatformOwner(user));
  if (isShopStaff) return null;

  const rate = await rateLimit(req, 30, "box-edit");
  if (!rate.success) return rateLimitResponse(rate.reset);

  if (quote.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "QUOTE_LOCKED",
        message: "This quote has been released. Contact the shop to change the boxes.",
      },
      { status: 409 },
    );
  }
  return null;
}
