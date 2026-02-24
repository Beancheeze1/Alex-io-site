"use client";

import * as React from "react";

export default function TenantsPage() {
  const [tenants, setTenants] = React.useState<any[]>([]);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");

  async function load() {
    const res = await fetch("/api/admin/tenants", { cache: "no-store" });
    const json = await res.json();
    if (json.ok) setTenants(json.tenants);
  }

  async function createTenant() {
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });
    const json = await res.json();
    if (json.ok) {
      setName("");
      setSlug("");
      load();
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold">Tenants</h1>

      <div className="border border-neutral-800 p-4 rounded">
        <div className="space-y-2">
          <input
            className="bg-neutral-900 p-2 w-full"
            placeholder="Company Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="bg-neutral-900 p-2 w-full"
            placeholder="Slug (acme)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <button
            className="bg-blue-600 px-3 py-2 rounded"
            onClick={createTenant}
          >
            Create Tenant
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {tenants.map((t) => (
          <div
            key={t.id}
            className="border border-neutral-800 p-3 rounded text-sm"
          >
            <div>{t.name}</div>
            <div className="text-neutral-400">
              {t.slug}.api.alex-io.com
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}