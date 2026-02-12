// app/start-quote/page.tsx
//
// Start Quote (Modal Shell)
// Option B: Dedicated /start-quote route that immediately opens a modal
// over a neutral background. This avoids any editor lifecycle / seeding risk.
//
// Step A ONLY:
// - Modal shell + progress rail + placeholder content
// - Close returns user via router.back() (fallback /admin)

"use client";

import * as React from "react";
import StartQuoteModal from "@/components/start-quote/StartQuoteModal";

export default function StartQuotePage() {
  return (
    <div className="min-h-screen bg-[#070A12]">
      {/* Subtle background glow to match the rest of the app vibe */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-140px] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-220px] h-[520px] w-[520px] rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      {/* Modal mounts immediately (Option B) */}
      <StartQuoteModal />
    </div>
  );
}
