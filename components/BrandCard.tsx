// components/BrandCard.tsx
export default function BrandCard() {
return (
<div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg">
<h2 className="mb-2 text-lg font-semibold text-neutral-900">Branded Block</h2>
<p className="mb-4 text-sm text-neutral-600">All colors/radii/shadows use tokens.</p>
<button className="rounded-lg bg-brand-600 px-4 py-2 text-white shadow-sm hover:bg-brand-700">Primary</button>
</div>
);
}