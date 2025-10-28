'use client';
import { useEffect, useMemo, useState } from 'react';

type Material = { id:number; name:string };
type Product = {
  id:number; sku:string; name:string;
  L:number; W:number; H:number;
  unit_price_usd?: number; bf_bill?: number; price_per_bf?: number;
  material_id?: number;
};

export default function ProductsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [pricing, setPricing] = useState<Product[]>([]);
  const [msg, setMsg] = useState('');

  const [form, setForm] = useState({
    sku:'', name:'', material_id:'', base_length_in:'', base_width_in:'', base_height_in:''
  });

  const [cavity, setCavity] = useState({ product_id:'', label:'', count:'1', cav_length_in:'', cav_width_in:'', cav_depth_in:'' });

  const canSaveProduct = useMemo(() =>
    form.sku && form.name && Number(form.material_id) > 0 &&
    [form.base_length_in, form.base_width_in, form.base_height_in].every(v => Number(v) > 0)
  , [form]);

  const canAddCavity = useMemo(() =>
    Number(cavity.product_id) > 0 && cavity.label &&
    [cavity.cav_length_in, cavity.cav_width_in, cavity.cav_depth_in].every(v => Number(v) > 0) &&
    Number(cavity.count) > 0
  , [cavity]);

  async function load() {
    setMsg('');
    const [m, p] = await Promise.all([
      fetch('/api/materials', { cache:'no-store' }).then(r=>r.json()),
      fetch('/api/products?t='+Math.random(), { cache:'no-store' }).then(r=>r.json()),
    ]);
    setMaterials(Array.isArray(m) ? m.map((x:any)=>({id:x.id,name:x.name})) : []);
    setPricing(Array.isArray(p) ? p : []);
  }
  useEffect(()=>{ load(); }, []);

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/products', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        sku: form.sku.trim(),
        name: form.name.trim(),
        material_id: Number(form.material_id),
        base_length_in: Number(form.base_length_in),
        base_width_in:  Number(form.base_width_in),
        base_height_in: Number(form.base_height_in),
      }),
    });
    const j = await r.json().catch(()=>({}));
    if (r.ok) { setForm({ sku:'', name:'', material_id:'', base_length_in:'', base_width_in:'', base_height_in:'' }); setMsg('Product saved'); await load(); }
    else setMsg(j?.error || 'Save failed');
  }

  async function addCavity(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const pid = Number(cavity.product_id);
    const r = await fetch(`/api/products/${pid}/cavities`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        items: [{
          label: cavity.label.trim(),
          count: Number(cavity.count || '1'),
          cav_length_in: Number(cavity.cav_length_in),
          cav_width_in:  Number(cavity.cav_width_in),
          cav_depth_in: Number(cavity.cav_depth_in),
        }]
      }),
    });
    const j = await r.json().catch(()=>({}));
    if (r.ok) { setCavity({ product_id:'', label:'', count:'1', cav_length_in:'', cav_width_in:'', cav_depth_in:'' }); setMsg('Cavity added'); await load(); }
    else setMsg(j?.error || 'Add cavity failed');
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold">Products</h1>

      {/* Create product */}
      <form onSubmit={createProduct} className="grid grid-cols-1 md:grid-cols-8 gap-3 bg-white p-4 rounded-2xl shadow">
        <input className="border rounded-lg p-2" placeholder="SKU" value={form.sku} onChange={(e)=>setForm({...form, sku:e.target.value})}/>
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Name" value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})}/>
        <select className="border rounded-lg p-2" value={form.material_id} onChange={(e)=>setForm({...form, material_id:e.target.value})}>
          <option value="">Material…</option>
          {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input className="border rounded-lg p-2" placeholder="L (in)" value={form.base_length_in} onChange={(e)=>setForm({...form, base_length_in:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="W (in)" value={form.base_width_in} onChange={(e)=>setForm({...form, base_width_in:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="H (in)" value={form.base_height_in} onChange={(e)=>setForm({...form, base_height_in:e.target.value})}/>
        <button disabled={!canSaveProduct} className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-40">Save</button>
      </form>

      {/* Add cavity */}
      <form onSubmit={addCavity} className="grid grid-cols-1 md:grid-cols-7 gap-3 bg-white p-4 rounded-2xl shadow">
        <select className="border rounded-lg p-2" value={cavity.product_id} onChange={(e)=>setCavity({...cavity, product_id:e.target.value})}>
          <option value="">Product…</option>
          {pricing.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
        </select>
        <input className="border rounded-lg p-2" placeholder="Label" value={cavity.label} onChange={(e)=>setCavity({...cavity, label:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Count" value={cavity.count} onChange={(e)=>setCavity({...cavity, count:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="L (in)" value={cavity.cav_length_in} onChange={(e)=>setCavity({...cavity, cav_length_in:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="W (in)" value={cavity.cav_width_in} onChange={(e)=>setCavity({...cavity, cav_width_in:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="D (in)" value={cavity.cav_depth_in} onChange={(e)=>setCavity({...cavity, cav_depth_in:e.target.value})}/>
        <button disabled={!canAddCavity} className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-40">Add cavity</button>
      </form>

      {msg && <div className="text-sm text-green-700">{msg}</div>}

      {/* Live pricing list from view */}
      <div className="overflow-x-auto rounded-2xl shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">SKU</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">L×W×H</th>
              <th className="text-left p-2">BF (bill)</th>
              <th className="text-left p-2">Unit $</th>
            </tr>
          </thead>
          <tbody>
            {pricing.length ? pricing.map(p=>(
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.sku}</td>
                <td className="p-2">{p.name}</td>
                <td className="p-2">{p.L}×{p.W}×{p.H}</td>
                <td className="p-2">{p.bf_bill ?? ''}</td>
                <td className="p-2">{p.unit_price_usd ?? ''}</td>
              </tr>
            )) : <tr><td colSpan={5} className="p-3">No products yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
