"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";

function Spinner({ className = "" }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}


/* ================= Brand Palette (stable) =================
   Edit to taste. These are high-contrast, print-friendly. */
const PALETTE = [
  "#111827", // black-ish
  "#2563EB", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#14B8A6", // teal
  "#E11D48", // rose
  "#0EA5E9", // sky
  "#84CC16", // lime
];
function colorForMaterial(id: number) {
  return PALETTE[Math.abs(id) % PALETTE.length];
}

/* ---------------- CSV Parser (no deps) ---------------- */
function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === "," && !inQ) { out.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = split(line); const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = (cols[idx] ?? "").trim(); });
    return row;
  });
}

/* ---------------- Types ---------------- */
type Material = { id: number; name: string };
type Curve = { material_id: number; static_psi: number; deflect_pct: number; g_level: number; source?: string };

/* ---------------- Helpers ---------------- */
function interpG(pts: Array<{deflect_pct:number; g_level:number}>, defl: number): number | null {
  if (!pts.length) return null;
  if (defl <= pts[0].deflect_pct) return pts[0].g_level;
  const last = pts[pts.length-1];
  if (defl >= last.deflect_pct) return last.g_level;
  for (let i=0;i<pts.length-1;i++){
    const a = pts[i], b = pts[i+1];
    if (defl >= a.deflect_pct && defl <= b.deflect_pct) {
      const t = (defl - a.deflect_pct) / (b.deflect_pct - a.deflect_pct);
      return a.g_level + t*(b.g_level - a.g_level);
    }
  }
  return null;
}

/* ====================================================================== */
export default function CushionCurvesAdmin() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [staticPsi, setStaticPsi]     = useState<string>("0.50");
  const [uploading, setUploading]     = useState(false);
  const [msg, setMsg]                 = useState<string>("");

  // Test Cushion widget
  const [tc, setTC] = useState({ weight_lbf: "12", area_in2: "48", thickness_in: "2", fragility_g: "50", drop_in: "24" });
  const [tcResults, setTCResults] = useState<any>(null);
  const fragilityLine = useMemo(()=> Number(tc.fragility_g || "0") || undefined, [tc.fragility_g]);

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

  useEffect(() => { refreshMaterials(); refreshCurves(); }, []);

  const curvesByMat = useMemo(() => {
    const map = new Map<number, Map<number, {deflect_pct:number; g_level:number}[]>>();
    for (const c of curves) {
      const m = map.get(c.material_id) || new Map<number, any[]>();
      const key = Number(c.static_psi.toFixed(3));
      const arr = m.get(key) || [];
      arr.push({ deflect_pct: c.deflect_pct, g_level: c.g_level });
      m.set(key, arr); map.set(c.material_id, m);
    }
    map.forEach(m => m.forEach(arr => arr.sort((a,b)=>a.deflect_pct-b.deflect_pct)));
    return map;
  }, [curves]);

  const overlayData = useMemo(() => {
    const ids = (selectedIds.length ? selectedIds : Array.from(curvesByMat.keys())).slice(0, 8);
    if (!ids.length) return [] as any[];
    const target = Number(staticPsi) || 0;
    const nearestFor: Record<number, {deflect_pct:number; g_level:number}[] | null> = {};
    ids.forEach(id => {
      const groups = curvesByMat.get(id);
      if (!groups) { nearestFor[id] = null; return; }
      const keys = Array.from(groups.keys());
      if (!keys.length) { nearestFor[id] = null; return; }
      const nearestKey = keys.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];
      nearestFor[id] = groups.get(nearestKey) || null;
    });
    const rows: any[] = [];
    for (let defl = 10; defl <= 70; defl += 1) {
      const row: any = { deflect_pct: defl };
      ids.forEach(id => {
        const pts = nearestFor[id];
        if (pts && pts.length >= 2) {
          const g = interpG(pts, defl);
          if (g != null) row[`g_m${id}`] = Number(g.toFixed(0));
        }
      });
      rows.push(row);
    }
    return rows;
  }, [curvesByMat, selectedIds, staticPsi]);

  const seriesMeta = useMemo(() => {
    const ids = (selectedIds.length ? selectedIds : Array.from(curvesByMat.keys())).slice(0, 8);
    return ids.map(id => ({
      key: `g_m${id}`,
      name: materials.find(m=>m.id===id)?.name || `Mat ${id}`,
      stroke: colorForMaterial(id),
    }));
  }, [materials, curvesByMat, selectedIds]);

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text(); const rows = parseCSV(text);
    const mapped: Curve[] = rows.map(r => ({
      material_id: Number(r["material_id"]) || Number(r["material"]),
      static_psi: Number(r["static_psi"]),
      deflect_pct: Number(r["deflect_pct"]) || Number(r["deflection_pct"]) || Number(r["deflect%"]),
      g_level: Number(r["g_level"]) || Number(r["g"]),
      source: r["source"],
    })).filter(x => x.material_id && x.static_psi >= 0 && x.deflect_pct >= 0 && x.g_level > 0);
    if (!mapped.length) { setMsg("Couldn’t find valid rows. Expected headers like material_id, static_psi, deflect_pct, g_level"); return; }

    setUploading(true); setMsg("");
    const chunkSize = 500; let upserted = 0; let failed = 0;
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
    await refreshCurves();
  }

  async function runTestCushion(e: React.FormEvent) {
    e.preventDefault(); setTCResults(null);
    const payload = {
      weight_lbf: Number(tc.weight_lbf),
      area_in2: Number(tc.area_in2),
      thickness_in: Number(tc.thickness_in),
      fragility_g: Number(tc.fragility_g),
      drop_in: Number(tc.drop_in),
    };
    const res = await fetch("/api/cushion/recommend?t="+Math.random(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(()=>({}));
    setTCResults(j);
    if (j?.input?.static_psi != null) setStaticPsi(String(j.input.static_psi));
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold">Cushion Curves</h1>

<div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-white p-4 rounded-2xl shadow">
  {/* Material multi-select */}
  <div className="md:col-span-4">
    <label className="text-sm text-gray-600">Materials (overlay)</label>
    <div className="border rounded-lg p-2 h-36 overflow-auto space-y-1">
      {materials.map(m => {
        const checked = selectedIds.includes(m.id);
        return (
          <label key={m.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setSelectedIds(prev => e.target.checked
                  ? [...prev, m.id] : prev.filter(x=>x!==m.id));
              }}
            />
            <span>{m.name}</span>
          </label>
        );
      })}
      {!materials.length && <div className="text-xs text-gray-500">No materials yet.</div>}
    </div>
    <div className="text-xs text-gray-500 mt-1">If none selected, the chart shows up to 8 materials.</div>
  </div>

  {/* Target psi */}
  <div className="md:col-span-2">
    <label className="text-sm text-gray-600">Target static load (psi)</label>
    <input className="border rounded-lg p-2 w-full" value={staticPsi} onChange={(e)=>setStaticPsi(e.target.value)} />
  </div>

  {/* CSV upload */}
  <div className="md:col-span-4">
    <label className="text-sm text-gray-600">Upload CSV (material_id, static_psi, deflect_pct, g_level[, source])</label>
    <input type="file" accept=".csv,text/csv" className="block w-full" onChange={handleCSV} />
    {msg && <div className="text-xs text-green-700 mt-1">{msg}</div>}
  </div>

  {/* Refresh + Export CSV (spinner/disable while uploading) */}
  <div className="md:col-span-2 flex items-end gap-2">
    <button
      disabled={uploading}
      onClick={() => refreshCurves()}
      className="bg-black text-white rounded-lg px-4 py-2 disabled:opacity-40 w-full"
    >
      Refresh
    </button>

    <a
      href={
        selectedIds.length === 1
          ? `/api/cushion/curves/export?material_id=${selectedIds[0]}`
          : `/api/cushion/curves/export`
      }
      role="button"
      aria-disabled={uploading}
      onClick={(e) => { if (uploading) e.preventDefault(); }}
      className={`bg-white border border-gray-300 rounded-lg px-4 py-2 text-center w-full flex items-center justify-center gap-2 ${uploading ? "opacity-50 pointer-events-none" : ""}`}
      title="Download a CSV of the currently selected material (or all if multiple/none selected)."
    >
      {uploading && <Spinner />}
      Export CSV
    </a>
  </div>
</div>


      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">G vs. Deflection% (overlay at nearest curves to {staticPsi} psi)</h2>
          <span className="text-xs text-gray-500">Toggle materials on the left to compare.</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={overlayData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="deflect_pct" label={{ value: "Deflection %", position: "insideBottomRight", offset: -5 }} />
              <YAxis label={{ value: "G-level", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              {fragilityLine ? <ReferenceLine y={fragilityLine} strokeDasharray="4 4" label={`Fragility G (${fragilityLine})`} /> : null}
              {seriesMeta.map(s => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  dot={false}
                  stroke={s.stroke}     // <<< colored line
                  strokeWidth={2}
                  activeDot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg font-medium mb-2">Test Cushion</h2>
        <form onSubmit={runTestCushion} className="grid grid-cols-1 md:grid-cols-10 gap-3">
          <input className="border rounded-lg p-2" placeholder="Weight (lbf)"      value={tc.weight_lbf}   onChange={(e)=>setTC({...tc, weight_lbf:e.target.value})}/>
          <input className="border rounded-lg p-2" placeholder="Contact area (in²)" value={tc.area_in2}     onChange={(e)=>setTC({...tc, area_in2:e.target.value})}/>
          <input className="border rounded-lg p-2" placeholder="Thickness (in)"     value={tc.thickness_in} onChange={(e)=>setTC({...tc, thickness_in:e.target.value})}/>
          <input className="border rounded-lg p-2" placeholder="Fragility G"        value={tc.fragility_g}  onChange={(e)=>setTC({...tc, fragility_g:e.target.value})}/>
          <input className="border rounded-lg p-2" placeholder="Drop height (in)"   value={tc.drop_in}      onChange={(e)=>setTC({...tc, drop_in:e.target.value})}/>
          <button className="bg-black text-white rounded-lg px-4 py-2 md:col-span-2">Recommend</button>
        </form>

        {tcResults?.recommendations?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Material</th>
                  <th className="p-2 text-left">Static psi</th>
                  <th className="p-2 text-left">Deflection %</th>
                  <th className="p-2 text-left">G</th>
                  <th className="p-2 text-left">Est $ / piece</th>
                </tr>
              </thead>
              <tbody>
                {tcResults.recommendations.map((r: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{r.material_name}</td>
                    <td className="p-2">{r.static_psi}</td>
                    <td className="p-2">{r.deflect_pct}</td>
                    <td className="p-2">{r.g}</td>
                    <td className="p-2">{r.est_piece_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-500 mt-2">
              We also drew a horizontal <b>Fragility G</b> line on the chart. Adjust inputs and re-run to compare.
            </div>
          </div>
        ) : tcResults?.error ? (
          <div className="text-sm text-red-600 mt-3">{String(tcResults.error)}</div>
        ) : null}
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
            {curves.length ? curves.map((c, i) => {
  const stroke = colorForMaterial(c.material_id);
  return (
    <tr key={i} className="border-t" style={{ borderLeft: `4px solid ${stroke}` }}>
      <td className="p-2">{materials.find(m => m.id === c.material_id)?.name || c.material_id}</td>
      <td className="p-2">{c.static_psi}</td>
      <td className="p-2">{c.deflect_pct}</td>
      <td className="p-2">{c.g_level}</td>
      <td className="p-2">{c.source || ""}</td>
    </tr>
  );
}) : (
  <tr><td colSpan={5} className="p-3">No curve points yet. Upload a CSV to begin.</td></tr>
)}

          </tbody>
        </table>
      </div>
    </div>
  );
}
