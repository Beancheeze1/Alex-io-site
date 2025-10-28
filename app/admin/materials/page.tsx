'use client';
import { useEffect, useMemo, useState } from 'react';

type Material = {
  id:number; name:string; density_lb_ft3:number; price_per_bf:number; kerf_waste_pct:number; min_charge_usd:number; active:boolean;
};

export default function MaterialsPage() {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name:'', density_lb_ft3:'', price_per_bf:'', kerf_waste_pct:'10', min_charge_usd:'0' });
  const [msg, setMsg] = useState('');

  const canSave = useMemo(() =>
    form.name && Number(form.density_lb_ft3) > 0 && Number(form.price_per_bf) > 0
  , [form]);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/materials', { cache:'no-store' });
    const data = await r.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/materials', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        name: form.name.trim(),
        density_lb_ft3: Number(form.density_lb_ft3),
        price_per_bf: Number(form.price_per_bf),
        kerf_waste_pct: Number(form.kerf_waste_pct || 10),
        min_charge_usd: Number(form.min_charge_usd || 0),
      }),
    });
    if (r.ok) { setForm({ name:'', density_lb_ft3:'', price_per_bf:'', kerf_waste_pct:'10', min_charge_usd:'0' }); await load(); setMsg('Saved'); }
    else { const err = await r.json().catch(()=>({})); setMsg(err?.error || 'Save failed'); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Materials</h1>

      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-white p-4 rounded-2xl shadow">
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Name (e.g., PE 2.2 lb)"
          value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Density lb/ft³"
          value={form.density_lb_ft3} onChange={(e)=>setForm({...form, density_lb_ft3:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Price per BF ($)"
          value={form.price_per_bf} onChange={(e)=>setForm({...form, price_per_bf:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Waste %"
          value={form.kerf_waste_pct} onChange={(e)=>setForm({...form, kerf_waste_pct:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Min charge $"
          value={form.min_charge_usd} onChange={(e)=>setForm({...form, min_charge_usd:e.target.value})}/>
        <button disabled={!canSave} className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-40">Save</button>
      </form>

      {msg && <div className="text-sm text-green-700">{msg}</div>}

      <div className="overflow-x-auto rounded-2xl shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">ID</th><th className="text-left p-2">Name</th>
              <th className="text-left p-2">Density</th><th className="text-left p-2">$/BF</th>
              <th className="text-left p-2">Waste %</th><th className="text-left p-2">Min $</th>
            </tr>
          </thead>
          <tbody>
          {loading ? <tr><td colSpan={6} className="p-3">Loading…</td></tr> :
            items.length ? items.map(m=>(
              <tr key={m.id} className="border-t">
                <td className="p-2">{m.id}</td><td className="p-2">{m.name}</td>
                <td className="p-2">{m.density_lb_ft3}</td><td className="p-2">{m.price_per_bf}</td>
                <td className="p-2">{m.kerf_waste_pct}</td><td className="p-2">{m.min_charge_usd}</td>
              </tr>
            )) : <tr><td colSpan={6} className="p-3">No materials yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
