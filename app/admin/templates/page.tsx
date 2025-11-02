// app/admin/templates/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Template = {
  id: string;
  tkey: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  vars: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const BASE = (typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_BASE_URL || "")
  : "") || "";

export default function TemplatesAdminPage() {
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Partial<Template>>({
    tkey: "",
    name: "",
    subject: "",
    body_html: "",
    body_text: "",
    vars: {},
    is_active: false,
  });

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/admin/templates`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed");
      setItems(j.items);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function createTemplate() {
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/admin/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setDraft({ tkey: "", name: "", subject: "", body_html: "", body_text: "", vars: {}, is_active: false });
      await refresh();
    } catch (e: any) {
      setError(e.message || "Create failed");
    }
  }

  async function saveRow(id: string, patch: Partial<Template>) {
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/admin/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Update failed");
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      const r = await fetch(`${BASE}/api/admin/templates/${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Delete failed");
    }
  }

  async function activate(id: string) {
    try {
      const r = await fetch(`${BASE}/api/admin/templates/${id}?action=activate`, { method: "PATCH" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Activate failed");
    }
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [items]
  );

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Templates</h1>

      {error && (
        <div className="rounded-xl border p-3 text-sm bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="text-lg font-medium">Create new template</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="border rounded-xl p-2" placeholder="tkey (unique)"
            value={draft.tkey || ""} onChange={e => setDraft(d => ({ ...d, tkey: e.target.value }))}/>
          <input className="border rounded-xl p-2" placeholder="name"
            value={draft.name || ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/>
          <input className="border rounded-xl p-2 md:col-span-2" placeholder="subject"
            value={draft.subject || ""} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}/>
          <textarea className="border rounded-xl p-2 md:col-span-2" rows={6} placeholder="body_html"
            value={draft.body_html || ""} onChange={e => setDraft(d => ({ ...d, body_html: e.target.value }))}/>
          <textarea className="border rounded-xl p-2 md:col-span-2" rows={4} placeholder="body_text"
            value={draft.body_text || ""} onChange={e => setDraft(d => ({ ...d, body_text: e.target.value }))}/>
          <textarea className="border rounded-xl p-2 md:col-span-2" rows={3} placeholder='vars (JSON)'
            value={JSON.stringify(draft.vars ?? {}, null, 2)}
            onChange={e => {
              try { setDraft(d => ({ ...d, vars: JSON.parse(e.target.value || "{}") })); }
              catch { /* ignore until valid */ }
            }}/>
        </div>
        <div className="flex gap-3">
          <button onClick={createTemplate} className="px-4 py-2 rounded-xl border shadow">
            Save Template
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Existing templates</h2>
        {loading ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="text-sm opacity-70">No templates yet.</div>
        ) : (
          <ul className="space-y-4">
            {sorted.map((t) => (
              <li key={t.id} className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border">{t.tkey}</span>
                    <span className="font-medium">{t.name}</span>
                    {t.is_active && <span className="text-xs px-2 py-0.5 rounded-full border">active</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => activate(t.id)} className="px-3 py-1 rounded-lg border">Activate</button>
                    <button onClick={() => deleteRow(t.id)} className="px-3 py-1 rounded-lg border">Delete</button>
                  </div>
                </div>

                <label className="block text-xs opacity-70">Subject</label>
                <input className="w-full border rounded-xl p-2" defaultValue={t.subject}
                  onBlur={(e) => saveRow(t.id, { subject: e.target.value })}/>

                <label className="block text-xs opacity-70 mt-2">HTML</label>
                <textarea className="w-full border rounded-xl p-2" rows={6} defaultValue={t.body_html}
                  onBlur={(e) => saveRow(t.id, { body_html: e.target.value })}/>

                <label className="block text-xs opacity-70 mt-2">Text</label>
                <textarea className="w-full border rounded-xl p-2" rows={4} defaultValue={t.body_text}
                  onBlur={(e) => saveRow(t.id, { body_text: e.target.value })}/>

                <label className="block text-xs opacity-70 mt-2">Vars (JSON)</label>
                <textarea className="w-full border rounded-xl p-2" rows={3} defaultValue={JSON.stringify(t.vars ?? {}, null, 2)}
                  onBlur={(e) => {
                    try { saveRow(t.id, { vars: JSON.parse(e.target.value || "{}") as any }); }
                    catch { alert("Vars must be valid JSON"); }
                  }}/>

                <details className="mt-2">
                  <summary className="cursor-pointer text-sm">Preview (HTML)</summary>
                  <div className="prose max-w-none border rounded-xl p-3 mt-2"
                       dangerouslySetInnerHTML={{ __html: t.body_html }} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
