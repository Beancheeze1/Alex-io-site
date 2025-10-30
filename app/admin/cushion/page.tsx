// app/admin/cushion/page.tsx
"use client";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";

type RecInput = {
  weight_lbf: number; area_in2: number; thickness_in: number; fragility_g: number; drop_in: number;
};
type ChartPoint = { psi: number; g: number };

export default function CushionAdminPage() {
  const [form, setForm] = useState<RecInput>({
    weight_lbf: 12, area_in2: 48, thickness_in: 2, fragility_g: 50, drop_in: 24,
  });
  const [data, setData] = useState<null | {
    ok: boolean;
    input: any;
    winner: any;
    top3: any[];
    chart: { series: { deflection_pct: number; points: ChartPoint[] }; fragility_g: number };
    note: string;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function onCalc(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/cushion/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Calc failed");
      setData(j);
    } catch (err: any) {
      setMsg(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold">Cushion Curve — Auto-Recommend</h1>

      <form onSubmit={onCalc} className="bg-white rounded-2xl shadow p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
        <label className="md:col-span-2 text-sm">Weight (lbf)
          <input className="border rounded-lg p-2 w-full"
                 type="number" step="0.1" value={form.weight_lbf}
                 onChange={e=>setForm({...form, weight_lbf: Number(e.target.value)})}/>
        </label>
        <label className="md:col-span-2 text-sm">Contact area (in²)
          <input className="border rounded-lg p-2 w-full"
                 type="number" step="0.1" value={form.area_in2}
                 onChange={e=>setForm({...form, area_in2: Number(e.target.value)})}/>
        </label>
        <label className="md:col-span-2 text-sm">Foam thickness (in)
          <input className="border rounded-lg p-2 w-full"
                 type="number" step="0.1" value={form.thickness_in}
                 onChange={e=>setForm({...form, thickness_in: Number(e.target.value)})}/>
        </label>
        <label className="md:col-span-2 text-sm">Fragility G (max)
          <input className="border rounded-lg p-2 w-full"
                 type="number" step="1" value={form.fragility_g}
                 onChange={e=>setForm({...form, fragility_g: Number(e.target.value)})}/>
        </label>
        <label className="md:col-span-2 text-sm">Drop height (in)
          <input className="border rounded-lg p-2 w-full"
                 type="number" step="1" value={form.drop_in}
                 onChange={e=>setForm({...form, drop_in: Number(e.target.value)})}/>
        </label>

        <button className="bg-black text-white rounded-lg px-4 py-2 md:col-span-2 disabled:opacity-40" disabled={busy}>
          {busy ? "Calculating…" : "Recommend"}
        </button>

        {msg && <div className="md:col-span-12 text-sm text-red-700">{msg}</div>}
      </form>

      {data && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="px-2 py-1 rounded bg-black text-white">
                {data.winner.foam_name} — {data.winner.density_lb_ft3} lb/ft³ @ {data.winner.deflection_pct}% defl
              </span>
              <span>Predicted G: <b>{data.winner.g_pred}</b> (limit {data.input.fragility_g})</span>
              <span>Static stress: <b>{data.input.psi.toFixed(3)} psi</b></span>
              <span>Thickness: <b>{data.input.thickness_in}"</b>, Drop: <b>{data.input.drop_in}"</b></span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Curve (scaled for thickness & drop)</h3>
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer>
                <LineChart data={data.chart.series.points}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="psi" label={{ value: "Static stress (psi)", position: "insideBottom", offset: -5 }} />
                  <YAxis label={{ value: "Transmitted G", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={data.chart.fragility_g} stroke="red" strokeDasharray="5 5" label="Fragility limit" />
                  <Line type="monotone" dataKey="g" name={`Best defl ${data.chart.series.deflection_pct}%`} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-500 mt-2">{data.note}</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Top options</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">Foam</th>
                    <th className="p-2 text-left">Density</th>
                    <th className="p-2 text-left">Defl %</th>
                    <th className="p-2 text-left">Pred G</th>
                    <th className="p-2 text-left">Meets</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top3.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{r.foam_name}</td>
                      <td className="p-2">{r.density_lb_ft3}</td>
                      <td className="p-2">{r.deflection_pct}</td>
                      <td className="p-2">{r.g_pred}</td>
                      <td className="p-2">{r.meets_fragility ? "✅" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
