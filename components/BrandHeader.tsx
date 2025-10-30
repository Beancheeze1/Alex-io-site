
// components/BrandHeader.tsx
'use client';


import Link from 'next/link';


export default function BrandHeader() {
return (
<header className="sticky top-0 z-40 w-full border-b border-neutral-200 bg-white/80 backdrop-blur dark:bg-neutral-100">
<div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
<Link href="/" className="flex items-center gap-2">
<div className="h-7 w-7 rounded-2xl bg-brand-500 shadow-sm" />
<span className="text-sm font-semibold tracking-wide text-neutral-800">Alex‑IO</span>
</Link>
<nav className="flex items-center gap-3 text-sm">
<Link href="/quotes" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Quotes</Link>
<Link href="/products" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Products</Link>
<Link href="/settings" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Settings</Link>
</nav>
</div>
</header>
);
}
