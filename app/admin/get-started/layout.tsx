// app/admin/get-started/layout.tsx
//
// Step 38E: admins only. cs and sales who type this address go to Quotes
// (the page is a client component with no role check of its own).

import { ReactNode } from "react";
import { requireShopAdmin } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";

export default async function GetStartedLayout({ children }: { children: ReactNode }) {
  await requireShopAdmin("/admin/get-started");
  return <>{children}</>;
}
