// app/admin/boxes/page.tsx
//
// Admin Carton Pricing Editor Stub
// Path A safe — no pricing logic yet, just a placeholder UI.
// Next step: display boxes with editable pricing + tiers.

"use client";

import * as React from "react";

export default function AdminBoxesPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-sky-300 mb-2">
          Carton pricing (RSC & mailers)
        </h1>
        <p className="text-sm text-slate-400">
          Manage carton SKUs, base pricing, and volume tiers used for add-on packaging quotes.
        </p>

        {/* Pricing editor table will be added here next */}
        <div className="mt-6 p-6 rounded-xl border border-slate-800 bg-slate-900/60">
          <p className="text-slate-400 text-sm">
            Loading carton catalog…
          </p>
        </div>
      </div>
    </main>
  );
}
