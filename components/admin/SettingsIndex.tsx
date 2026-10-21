// components/admin/SettingsIndex.tsx
//
// Step 38C: /admin/settings is now a short list of the settings pages.
// Old bookmarks and links with a section anchor (#freight, #foam-rates,
// #quote-terms) go straight to the page that section moved to.

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const HASH_TO_PAGE: Record<string, string> = {
  freight: "/admin/settings/freight",
  shipping: "/admin/settings/freight",
  "foam-rates": "/admin/settings/foam",
  "quote-terms": "/admin/settings/terms",
};

export default function SettingsIndex({ sellsFoam }: { sellsFoam: boolean }) {
  const router = useRouter();

  React.useEffect(() => {
    const id = window.location.hash.slice(1);
    const to = HASH_TO_PAGE[id];
    if (to && (sellsFoam || to !== "/admin/settings/foam")) router.replace(to);
  }, [router, sellsFoam]);

  const cards = [
    {
      href: "/admin/settings/freight",
      title: "Freight & shipping",
      text: "Ship-from ZIP, freight terms, the rate table and the rough shipping estimate.",
    },
    ...(sellsFoam
      ? [
          {
            href: "/admin/settings/foam",
            title: "Foam cutting rates",
            text: "Default foam rates, markup, CNC / die / press / lamination costs and foam review checks.",
          },
        ]
      : []),
    {
      href: "/admin/settings/terms",
      title: "Quote terms & buyer emails",
      text: "Quote validity, lead time, buyer status emails, reply-to and reminders.",
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        <header className="mb-6 border-b border-[var(--border)] pb-5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Settings</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Pick what you want to change.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2" data-settings-index>
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 hover:border-[var(--action-primary)]"
            >
              <div className="text-sm font-medium text-[var(--text-primary)]">{c.title}</div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{c.text}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
