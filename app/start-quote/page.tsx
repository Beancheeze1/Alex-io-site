// app/start-quote/page.tsx
//
// Start Quote (Modal Shell)
// Option B: Dedicated /start-quote route that immediately opens a modal
// over a neutral background. This avoids any editor lifecycle / seeding risk.

"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import StartQuoteModal from "@/components/start-quote/StartQuoteModal";

export default function StartQuotePage() {
  const sp = useSearchParams();

  React.useEffect(() => {
    const tenant = (sp.get("tenant") || sp.get("t") || "").trim();
    if (!tenant) return;

    fetch(`/api/tenant/theme?tenant=${encodeURIComponent(tenant)}&t=${Math.random()}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok || !data?.theme_json) return;

        const primary = data.theme_json.primaryColor || "#0ea5e9";
        const secondary = data.theme_json.secondaryColor || "#6366f1";

        document.documentElement.style.setProperty("--tenant-primary", primary);
        document.documentElement.style.setProperty("--tenant-secondary", secondary);
      })
      .catch(() => {});
  }, [sp]);

  return (
    <div className="min-h-screen bg-[#070A12]">
      {/* Subtle background glow to match the rest of the app vibe */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-140px] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[color:color-mix(in_srgb,var(--tenant-secondary)_12%,transparent)] blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-220px] h-[520px] w-[520px] rounded-full bg-[color:color-mix(in_srgb,var(--tenant-primary)_12%,transparent)] blur-3xl" />

        {/* optional subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            backgroundPosition: "0 0",
          }}
        />
      </div>

      {/* Modal mounts immediately (Option B) */}
      <StartQuoteModal />
    </div>
  );
}
