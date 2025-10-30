// app/admin/materials/page.tsx
"use client";
import { useEffect, useState } from "react";

type Material = {
  id: number;
  name: string;
  price_per_cuin: number;
  kerf_waste_pct: number;
  min_charge_usd: number;
  density_lb_ft3: number;
};

function N(x: any) { const n = Number(x); return isFinite(n) ? n : 0; }

export default function MaterialsAdminPage() {
  const [rows, setRows] = useState<Material[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    price_per_cuin: "",
    price_per_bf: "",
    price_per_cuft: "",
    kerf_waste_pct: "10",
    min_charge_usd: "15",
    density_lb_ft3: "",
  });
  const [msg, setMsg] = useState<string>("");

  async function load() {
    const res = await fetch("/api/materials", { cache: "no-store" });
    const j = await res.json();
    setRows(Array.isArray(j) ? j : []);
  }
  useEffect(()=>{ load(); }, []);

  function cuinFromForm(): number {
    const p_cuin = N(form.price_per_cuin);
    const p_bf   = N(form.price_per_bf);
    const p_cuft = N(form.price_per_cuft);
    return p_cuin || (p_cuft ? p_cuft / 1728 : 0) || (p_bf ? p_bf / 144 : 0);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const payload: any = {
        name: form.name.trim(),
        kerf_waste_pct: N(form.kerf_waste_pct),
        min_charge_usd: N(form.min_charge_usd),
        density_lb_ft3: N(form.density_lb_ft3),
      };
      // send whichever price user entered
      if (form.price_per_cuin) payload.price_per_cuin = N(form.price_per_cuin);
      if (form.price_per_bf)   payload.price_per_bf   = N(form.price_per_bf);
      if (form.price_per_cuft) payload.price_per_cuft = N(form.price_per_cuft);

      const res = await fetch("/api/materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Create failed");
      setMsg(`Created material #${j.id}`);
      setForm({
        name: "",
        price_per_cuin: "",
        price_per_bf: "",
        price_per_cuft: "",
        kerf_waste_pct: "10",
        min_charge_usd: "15",
        density_lb_ft3: "",
      });
      await load();
    } catch (err: any) {
      setMsg(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPatch(id: number, patch: Partial<Material> & { price_per_bf?: number; price_per_cuft?: number }) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Update failed");
      setMsg(`Updated #${id}`);
      await load();
    } catch (e: any) {
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm(`Delete material #${id}?`)) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/materials/${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Delete failed");
      setMsg(`Deleted #${id}`);
      await load();
    } catch (e: any) {
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold">Materials — Pricing per cubic inch</h1>

      <form onSubmit={onCreate} className="bg-white rounded-2xl shadow p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
        <input className="border rounded-lg p-2 md:col-span-3" placeholder="Name (e.g., PE 1.7 lb)"
               value={form.name} onChange={e=>setForm({...form, name:e.target.value})} />

        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Price / cu-in"
               value={form.price_per_cuin} onChange={e=>setForm({...form, price_per_cuin:e.target.value})} />
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Price / BF (optional)"
               value={form.price_per_bf} onChange={e=>setForm({...form, price_per_bf:e.target.value})} />
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Price / cu-ft (optional)"
               value={form.price_per_cuft} onChange={e=>setForm({...form, price_per_cuft:e.target.value})} />

        <input className="border rounded-lg p-2 md:col-span-1" placeholder="Kerf %"
               value={form.kerf_waste_pct} onChange={e=>setForm({...form, kerf_waste_pct:e.target.value})} />
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Min charge $"
               value={form.min_charge_usd} onChange={e=>setForm({...form, min_charge_usd:e.target.value})} />
        <input className="border rounded-lg p-2 md:col-span-2" placeholder="Density lb/ft³ (optional)"
               value={form.density_lb_ft3} onChange={e=>setForm({...form, density_lb_ft3:e.target.value})} />

        <div className="md:col-span-12 text-xs text-gray-500">
          Computed price/cu-in from inputs: <b>${cuinFromForm().toFixed(6)}</b> (cu-ft ÷ 1728, BF ÷ 144).
        </div>

        <button className="bg-black text-white rounded-lg px-4 py-2 md:col-span-2" disabled={busy}>Add material</button>
        {msg && <div className="md:col-span-10 text-sm text-green-700 self-center">{msg}</div>}
      </form>

      <div className="bg-white rounded-2xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">ID</th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">$/cu-in</th>
              <th className="p-2 text-left">$/BF</th>
              <th className="p-2 text-left">$/cu-ft</th>
              <th className="p-2 text-left">Kerf %</th>
              <th className="p-2 text-left">Min $</th>
              <th className="p-2 text-left">Density</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const perBF = r.price_per_cuin * 144;
              const perCF = r.price_per_cuin * 1728;
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.id}</td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">${r.price_per_cuin.toFixed(6)}</td>
                  <td className="p-2">${perBF.toFixed(2)}</td>
                  <td className="p-2">${perCF.toFixed(2)}</td>
                  <td className="p-2">
                    <input className="border rounded p-1 w-20"
                           defaultValue={r.kerf_waste_pct}
                           onBlur={e=>onPatch(r.id, { kerf_waste_pct: N(e.target.value) })}/>
                  </td>
                  <td className="p-2">
                    <input className="border rounded p-1 w-24"
                           defaultValue={r.min_charge_usd}
                           onBlur={e=>onPatch(r.id, { min_charge_usd: N(e.target.value) })}/>
                  </td>
                  <td className="p-2">
                    <input className="border rounded p-1 w-24"
                           defaultValue={r.density_lb_ft3}
                           onBlur={e=>onPatch(r.id, { density_lb_ft3: N(e.target.value) })}/>
                  </td>
                  <td className="p-2 space-x-2">
                    <button className="text-blue-600 underline"
                            onClick={()=>onPatch(r.id, { price_per_cuin: r.price_per_cuin })}>
                      Save
                    </button>
                    <button className="text-red-600 underline" onClick={()=>onDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="p-4">No materials yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
