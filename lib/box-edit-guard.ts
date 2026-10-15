// lib/box-edit-guard.ts
//
// Step 14: who may add, swap or remove boxes on a saved quote
// (/api/boxes/add-to-quote, /add-custom-to-quote, /remove-from-quote).
//   - Staff (admin / cs / sales) of the quote's shop, or the platform owner:
//     always, including released quotes.
//   - Everyone else (the buyer's own editor and quote page): rate-limited,
//     needs the quote's edit grant (Step 21: the link from the quote email,
//     or the browser that started the quote), and refused once the quote is
//     released (locked).
// Returns a response to send back, or null when the change may go ahead.

import { NextRequest, NextResponse } from "next/server";
import { buyerEditGuard } from "@/lib/quote-edit";

export async function boxEditGuard(
  req: NextRequest,
  quote: { quote_no: string; tenant_id: number | string | null; locked?: boolean | null },
): Promise<NextResponse | null> {
  return buyerEditGuard(req, quote, {
    rateName: "box-edit",
    perMin: 30,
    lockedMessage: "This quote has been released. Contact the shop to change the boxes.",
  });
}
