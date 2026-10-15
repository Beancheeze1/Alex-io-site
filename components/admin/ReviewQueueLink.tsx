// components/admin/ReviewQueueLink.tsx
//
// Step 32: "Review (N)" in the admin menu, N = items in the review queue
// that aren't snoozed (GET /api/admin/review-queue?count=1).

"use client";

import * as React from "react";
import Link from "next/link";

export default function ReviewQueueLink() {
  const [n, setN] = React.useState<number | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/admin/review-queue?count=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok) setN(Number(j.counts?.total) || 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Link href="/admin/review" className="hover:text-[var(--text-primary)]" data-review-link>
      Review
      {n ? (
        <span className="ml-1 rounded-full bg-[var(--attention)] px-1.5 py-0.5 text-[10px] font-semibold text-white" data-review-count>
          {n}
        </span>
      ) : null}
    </Link>
  );
}
