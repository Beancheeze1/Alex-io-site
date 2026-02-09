"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildQuoteNo() {
  // Keep consistent with your existing starter: Q-AI-YYYYMMDD-HHMMSS
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `Q-AI-${y}${m}${day}-${hh}${mm}${ss}`;
}

export default function SalesShortcutToEditor() {
  const router = useRouter();
  const params = useParams() as { sales_slug?: string };

  React.useEffect(() => {
    const slug = String(params?.sales_slug || "").trim();
    if (!slug) {
      router.replace("/quote/layout");
      return;
    }

    const quoteNo = buildQuoteNo();
    const p = new URLSearchParams();
    p.set("quote_no", quoteNo);
    p.set("sales_rep_slug", slug);

    // Blank editor: no dims/qty/material/customer seeds.
    router.replace(`/quote/layout?${p.toString()}`);
  }, [params?.sales_slug, router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="text-sm text-slate-300">Opening editor</div>
    </main>
  );
}
