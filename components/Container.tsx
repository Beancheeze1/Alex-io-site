// components/Container.tsx
import { ReactNode } from 'react';


export default function Container({ children }: { children: ReactNode }) {
return (
<div className="mx-auto max-w-7xl p-4">
<div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-md">
{children}
</div>
</div>
);
}