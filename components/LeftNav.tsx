// components/LeftNav.tsx
'use client';


import Link from 'next/link';
import { usePathname } from 'next/navigation';


const items = [
{ href: '/dashboard', label: 'Dashboard' },
{ href: '/quotes', label: 'Quotes' },
{ href: '/pricebooks', label: 'Price Books' },
{ href: '/materials', label: 'Materials' },
];


export default function LeftNav() {
const pathname = usePathname();
return (
<aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white/60 p-3 md:block">
<ul className="space-y-1">
{items.map((it) => {
const active = pathname?.startsWith(it.href);
return (
<li key={it.href}>
<Link
href={it.href}
className={`block rounded-md px-3 py-2 text-sm ${
active
? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
: 'text-neutral-700 hover:bg-neutral-100'
}`}
>
{it.label}
</Link>
</li>
);
})}
</ul>
</aside>
);
}