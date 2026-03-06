"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

export default function SalesShortcutToSplash() {
  const router = useRouter();
  const params = useParams() as { sales_slug?: string };

  React.useEffect(() => {
    const slug = String(params?.sales_slug || "").trim();

    // Redirect to the splash/quote-start page, passing the slug so it
    // gets threaded through to the editor when the customer completes the chatbot.
    if (slug) {
      router.replace(`/?sales_rep_slug=${encodeURIComponent(slug)}`);
    } else {
      router.replace("/");
    }
  }, [params?.sales_slug, router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="text-sm text-slate-300">Loading…</div>
    </main>
  );
}
