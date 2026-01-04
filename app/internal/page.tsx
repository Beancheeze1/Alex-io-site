// app/internal/page.tsx
//
// Admin-only internal landing page (first RBAC vertical slice).

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies, isRoleAllowed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InternalHome() {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/internal")}`);
  }

  // Admin-only
  if (!isRoleAllowed(user, ["admin"])) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-neutral-600">
          Your account does not have access to this page.
        </p>
        <div className="mt-6 rounded-xl bg-neutral-100 p-4 text-sm">
          <div>
            <span className="font-semibold">Signed in as:</span>{" "}
            {user.email}
          </div>
          <div>
            <span className="font-semibold">Role:</span> {user.role}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Internal (Admin)</h1>
      <p className="mt-2 text-neutral-600">
        RBAC slice is live. This page is Admin-only.
      </p>

      <div className="mt-6 rounded-2xl bg-neutral-100 p-5">
        <div className="text-sm">
          <div>
            <span className="font-semibold">User:</span> {user.name} ({user.email})
          </div>
          <div>
            <span className="font-semibold">Role:</span> {user.role}
          </div>
        </div>

        <div className="mt-4 text-sm text-neutral-700">
          Next: expand gating to editor + CAD downloads after we verify whoami + admin API protection.
        </div>
      </div>
    </div>
  );
}
