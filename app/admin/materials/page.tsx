'use client';
import { useEffect, useMemo, useState } from 'react';

type Mat = {
  id:number; name:string; density_lb_ft3:number;
  price_per_bf:number; price_per_cuin:number;
  kerf_waste_pct:number; min_charge_usd:number; active:boolean;
};

export default function MaterialsPage() {
  const [items, setItems] = useState<Mat[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [form, setForm] = useState({
    name:'', density_lb_ft3:'', price_per_bf:'', price_per_cuin:'', kerf_waste_pct:'10', min_charge_usd:'0'
  });

  const canSave = useMemo(() => {
    const d = Number(form.density_lb_ft3);
    const pbf = Number(form.price_per_bf);
    const pcu = Number(form.price_per_cuin);
    return form.name.trim().length > 0 && d > 0 && ((pbf > 0) || (pcu > 0));
  }, [form]);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/materials', { cache:'no-store' });
    const data = await r.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // link the two price fields: change either → derive the other (but don’t trap user)
  function onChangeBF(v: string) {
    const num = Number(v);
    setForm(f => ({
      ...f,
      price_per_bf: v,
      price_per_cuin: num > 0 ? (num/1728).toFixed(6) : f.price_per_cuin
    }));
  }
  function onChangeCUIN(v: string) {
    const num = Number(v);
    setForm(f => ({
      ...f,
      price_per_cuin: v,
      price_per_bf: num > 0 ? (num*1728).toFixed(2) : f.price_per_bf
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const payload:any = {
      name: form.name.trim(),
      density_lb_ft3: Number(form.density_lb_ft3),
      kerf_waste_pct: Number(form.kerf_waste_pct || '10'),
      min_charge_usd: Number(form.min_charge_usd || '0')
    };
    if (Number(form.price_per_bf) > 0) payload.price_per_bf = Number(form.price_per_bf);
    else if (Number(form.price_per_cuin) > 0) payload.price_per_cuin = Number(form.price_per_cuin);

    const r = await fetch('/api/materials', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(()=>({}));
    if (r.ok) {
      setForm({ name:'', density_lb_ft3:'', price_per_bf:'', price_per_cuin:'', kerf_waste_pct:'10', min_charge_usd:'0' });
      setMsg('Saved');
      await load();
    } else {
      setMsg(j?.error || 'Save failed');
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Materials</h1>

      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-8 gap-3 bg-white p-4 rounded-2xl shadow">
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Name (e.g., PE 2.2 lb)"
          value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Density lb/ft³"
          value={form.density_lb_ft3} onChange={(e)=>setForm({...form, density_lb_ft3:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="$ / cu ft"
          value={form.price_per_bf} onChange={(e)=>onChangeBF(e.target.value)}/>
        <input className="border rounded-lg p-2" placeholder="$ / cu in"
          value={form.price_per_cuin} onChange={(e)=>onChangeCUIN(e.target.value)}/>
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
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Density</th>
              <th className="text-left p-2">$ / cu ft</th>
              <th className="text-left p-2">$ / cu in</th>
              <th className="text-left p-2">Waste %</th>
              <th className="text-left p-2">Min $</th>
            </tr>
          </thead>
          <tbody>
          {loading ? <tr><td colSpan={7} className="p-3">Loading…</td></tr> :
            items.length ? items.map(m=>(
              <tr key={m.id} className="border-t">
                <td className="p-2">{m.id}</td>
                <td className="p-2">{m.name}</td>
                <td className="p-2">{m.density_lb_ft3}</td>
                <td className="p-2">{m.price_per_bf}</td>
                <td className="p-2">{m.price_per_cuin}</td>
                <td className="p-2">{m.kerf_waste_pct}</td>
                <td className="p-2">{m.min_charge_usd}</td>
              </tr>
            )) : <tr><td colSpan={7} className="p-3">No materials yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
