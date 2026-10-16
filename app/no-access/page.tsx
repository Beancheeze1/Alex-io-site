// app/no-access/page.tsx
//
// Step 36B: where a signed-in account without a staff role lands after login
// (e.g. an old "viewer" account; that role is retired). Says so plainly and
// offers sign-out. Buyers use their shop's "Your orders" page instead.

"use client";

import * as React from "react";
import LogoutButton from "@/components/LogoutButton";

export default function NoAccessPage() {
  const [email, setEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEmail(j?.user?.email ? String(j.user.email) : null))
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-center shadow-sm" data-no-access>
        <h1 className="mb-2 text-xl font-medium text-[var(--text-primary)]">You&apos;re signed in</h1>
        <p className="mb-2 text-sm text-[var(--text-secondary)]">
          {email ? <>Your account ({email}) </> : "Your account "}
          doesn&apos;t have staff access yet. Ask your admin to give you the sales, customer service or admin role.
        </p>
        <p className="mb-5 text-xs text-[var(--text-muted)]">Looking for your orders? Use the &quot;Your orders&quot; link on your supplier&apos;s quote page.</p>
        <LogoutButton />
      </div>
    </div>
  );
}
