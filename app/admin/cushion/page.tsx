"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

// Lightweight CSV parser (no deps). Expects header row. Returns array of objects keyed by headers.
function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) { out.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = split(line);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = (cols[idx] ?? "").trim(); });
    return row;
  });
}

type Material = { id: number; name: string };
type Curve = { material_id: number; static_psi: number; deflect_pct: number; g_level: number; source?: string };

export default function CushionCurvesAdmin() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [selectedMat, setSelectedMat] = useState<string>("");
  const [staticPsi, setStaticPsi] = useState<string>("0.50");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function refreshMaterials() {
    const res = await fetch("/api/materials", { cache: "no-store" });
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    setMaterials(rows.map((r: any) => ({ id: r.id, name: r.name })));
  }
  async function refreshCurves(material_id?: number) {
    const url = material_id ? `/api/cushion/curves?material_id=${material_id}` : "/api/cushion/curves";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    const rows: any[] = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
    setCurves(rows.map(r => ({
      material_id: Number(r.material_id),
      static_psi: Number(r.static_psi),
      deflect_pct: Number(r.deflect_pct),
      g_level: Number(r.g_level),
      source: r.source ?? undefined,
    })));
  }

  useEffect(() => { refreshMaterials(); }, []);
  useEffect(() => { const mid = Number(selectedMat) || undefined; refreshCurves(mid); }, [selectedMat]);

  // Pick the nearest static_psi set per material for the chart
  const displayData = useMemo(() => {
    const mid = Number(selectedMat) || 0;
    const all = curves.filter(c => !mid || c.material_id === mid);
    if (!all.length) return [] as Curve[];
    const target = Number(staticPsi) || 0;
    const byMat = new Map<number, Curve[]>();
    all.forEach(c => { const arr = byMat.get(c.material_id) || []; arr.push(c); byMat.set(c.material_id, arr); });
    const chosen: Curve[] = [];
    byMat.forEach(arr => {
      const groups = new Map<number, Curve[]>();
      arr.forEach(p => { const key = Number(p.static_psi.toFixed(3)); (groups.get(key) || groups.set(key, []).get(key)!).push(p); });
      const keys = Array.from(groups.keys());
      const nearest = keys.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];
      (groups.get(nearest) || []).forEach(p => chosen.push(p));
    });
    return chosen.sort((a,b)=>a.deflect_pct - b.deflect_pct);
  }, [curves, selectedMat, staticPsi]);

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);

    const mapped: Curve[] = rows.map(r => ({
      material_id: Number(r["material_id"]) || Number(r["material"]),
      static_psi: Number(r["static_psi"]),
      deflect_pct: Number(r["deflect_pct"]) || Number(r["deflection_pct"]) || Number(r["deflect%"]),
      g_level: Number(r["g_level"]) || Number(r["g"]),
      source: r["source"],
    })).filter(x => x.material_id && x.static_psi >= 0 && x.deflect_pct >= 0 && x.g_level > 0);

    if (!mapped.length) { setMsg("Couldn’t find valid rows. Expected headers like material_id, static_psi, deflect_pct, g_level"); return; }

    setUploading(true); setMsg("");
    const chunkSize = 500;
    let upserted = 0; let failed = 0;
    for (let i = 0; i < mapped.length; i += chunkSize) {
      const chunk = mapped.slice(i, i + chunkSize);
      try {
        const res = await fetch("/api/cushion/curves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: chunk }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok) upserted += (j?.upserted ?? chunk.length); else failed += chunk.length;
      } catch { failed += chunk.length; }
    }
    setUploading(false);
    setMsg(`Uploaded ${upserted} points${failed ? ", failed " + failed : ""}.`);
    await refreshCurves(Number(selectedMat) || undefined);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold">Cushion Curves</h1>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-white p-4 rounded-2xl shadow">
        <div className="md:col-span-2">
          <label className="text-sm text-gray-600">Material</label>
          <select className="border rounded-lg p-2 w-full" value={selectedMat} onChange={(e)=>setSelectedMat(e.target.value)}>
            <option value="">All materials</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-600">Target static load (psi)</label>
          <input className="border rounded-lg p-2 w-full" value={staticPsi} onChange={(e)=>setStaticPsi(e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <label className="text-sm text-gray-600">Upload CSV (material_id, static_psi, deflect_pct, g_level[, source])</label>
          <input type="file" accept=".csv,text/csv" className="block w-full" onChange={handleCSV} />
        </div>
        <div className="flex items-end">
          <button disabled={uploading} onClick={() => refreshCurves(Number(selectedMat)||undefined)} className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-40">Refresh</button>
        </div>
      </div>

      {msg && <div className="text-sm text-green-700">{msg}</div>}

      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">G vs. Deflection% (nearest curves to {staticPsi} psi)</h2>
          <span className="text-xs text-gray-500">Tip: upload or pick another material to update.</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="deflect_pct" label={{ value: "Deflection %", position: "insideBottomRight", offset: -5 }} />
              <YAxis label={{ value: "G-level", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="g_level" name="G" dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Material</th>
              <th className="p-2 text-left">Static psi</th>
              <th className="p-2 text-left">Deflect %</th>
              <th className="p-2 text-left">G</th>
              <th className="p-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            {curves.length ? curves.map((c, i) => (
              <tr key={i} className="border-t">
                <td className="p-2">{materials.find(m => m.id === c.material_id)?.name || c.material_id}</td>
                <td className="p-2">{c.static_psi}</td>
                <td className="p-2">{c.deflect_pct}</td>
                <td className="p-2">{c.g_level}</td>
                <td className="p-2">{c.source || ""}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="p-3">No curve points yet. Upload a CSV to begin.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
