// components/TokenPreview.tsx
export default function TokenPreview() {
const swatches = [
{ name: 'brand-500', var: 'var(--color-brand-500)' },
{ name: 'brand-600', var: 'var(--color-brand-600)' },
{ name: 'brand-700', var: 'var(--color-brand-700)' },
{ name: 'accent', var: 'var(--color-accent)' },
{ name: 'success', var: 'var(--color-success)' },
{ name: 'warning', var: 'var(--color-warning)' },
{ name: 'danger', var: 'var(--color-danger)' },
];


return (
<div className="space-y-6">
<section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-md">
<h2 className="mb-4 text-lg font-semibold text-neutral-900">Brand Buttons</h2>
<div className="flex flex-wrap gap-3">
<button className="rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Primary</button>
<button className="rounded-lg bg-neutral-200 px-4 py-2 text-neutral-800 hover:bg-neutral-300">Secondary</button>
<button className="rounded-lg bg-success px-4 py-2 text-white hover:opacity-90">Success</button>
<button className="rounded-lg bg-warning px-4 py-2 text-white hover:opacity-90">Warning</button>
<button className="rounded-lg bg-danger px-4 py-2 text-white hover:opacity-90">Danger</button>
</div>
</section>


<section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-md">
<h2 className="mb-4 text-lg font-semibold text-neutral-900">Color Swatches</h2>
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
{swatches.map((s) => (
<div key={s.name} className="rounded-xl border border-neutral-200 p-3">
<div className="h-12 w-full rounded-lg" style={{ background: s.var }} />
<div className="mt-2 text-xs text-neutral-600">{s.name}</div>
<div className="text-[10px] text-neutral-500">{s.var}</div>
</div>
))}
</div>
</section>
</div>
);
}