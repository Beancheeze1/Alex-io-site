// components/admin/AdminNav.tsx
//
// Step 38A: the admin header menu, grouped (Home, Quotes, Pricing, Shop
// settings, Reports, and the platform owner's Alex-IO menu). The layout
// decides which menus and items each role and shop gets (quote types);
// this only draws them. One menu open at a time; it closes on a click
// outside, Escape, or picking a link. Works on a phone (the header wraps
// and the dropdown opens under its button).

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = { href: string; label: string; review?: boolean };
export type AdminNavMenu = { key: string; label: string; items: AdminNavItem[]; align?: "left" | "right" };

function pathOf(href: string): string {
  return href.split("#")[0].split("?")[0];
}

/** The menu holds the page we're on (exact match, or a sub-page like /admin/quotes/Q-...). */
function holdsPath(menu: AdminNavMenu, pathname: string): boolean {
  return menu.items.some((it) => {
    const p = pathOf(it.href);
    if (p === "/admin") return pathname === "/admin";
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

export default function AdminNav({
  home,
  menus,
  ownerMenu,
}: {
  home: { href: string; label: string } | null;
  menus: AdminNavMenu[];
  ownerMenu: AdminNavMenu | null;
}) {
  const pathname = usePathname() || "";
  const [open, setOpen] = React.useState<string | null>(null);
  const [reviewCount, setReviewCount] = React.useState<number>(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const wantsReview = menus.some((m) => m.items.some((it) => it.review));

  // Review queue count (same source as the old "Review (N)" link).
  React.useEffect(() => {
    if (!wantsReview) return;
    let alive = true;
    fetch("/api/admin/review-queue?count=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok) setReviewCount(Number(j.counts?.total) || 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wantsReview, pathname]);

  // Close on route change, outside click and Escape.
  React.useEffect(() => {
    setOpen(null);
  }, [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const badge = (n: number) =>
    n > 0 ? (
      <span
        className="ml-1 rounded-full bg-[var(--attention)] px-1.5 py-0.5 text-[10px] font-semibold text-white"
        data-review-count
      >
        {n}
      </span>
    ) : null;

  const linkCls = (active: boolean) =>
    `rounded-md px-2 py-1 ${active ? "bg-[var(--surface-subtle)] text-[var(--text-primary)]" : "hover:text-[var(--text-primary)]"}`;

  const renderMenu = (m: AdminNavMenu) => {
    if (m.items.length === 0) return null;
    const isOpen = open === m.key;
    const active = holdsPath(m, pathname);
    const menuReview = m.items.some((it) => it.review) ? reviewCount : 0;
    return (
      <div key={m.key} className="relative" data-admin-menu={m.key}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setOpen(isOpen ? null : m.key)}
          className={`${linkCls(active || isOpen)} inline-flex items-center gap-1`}
        >
          {m.label}
          {badge(menuReview)}
          <span aria-hidden className="text-[9px] opacity-70">
            ▾
          </span>
        </button>
        {isOpen ? (
          <div
            role="menu"
            className={`absolute ${m.align === "right" ? "right-0" : "left-0"} z-50 mt-1 min-w-[210px] rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)]`}
          >
            {m.items.map((it) => {
              const p = pathOf(it.href);
              const here = p === "/admin" ? pathname === "/admin" && !it.href.includes("#") : pathname === p;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(null)}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] ${
                    here
                      ? "bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                  }`}
                  data-admin-menu-item={it.href}
                >
                  <span>{it.label}</span>
                  {it.review ? badge(reviewCount) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1 text-xs text-[var(--text-muted)]" data-admin-nav>
      {home ? (
        <Link href={home.href} className={linkCls(pathname === home.href)} data-admin-menu="home">
          {home.label}
        </Link>
      ) : null}
      {menus.map(renderMenu)}
      {ownerMenu && ownerMenu.items.length > 0 ? (
        <>
          <span aria-hidden className="mx-1 h-4 w-px bg-[var(--border)]" />
          {renderMenu(ownerMenu)}
        </>
      ) : null}
    </div>
  );
}
