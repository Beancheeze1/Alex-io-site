// components/admin/SpecRequestStatus.tsx
"use client";

import * as React from "react";

const OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "quoted", label: "Quoted" },
  { value: "closed", label: "Closed" },
];

export default function SpecRequestStatus({ id, initial }: { id: number; initial: string }) {
  const [value, setValue] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spec-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setValue(prev);
        setError(data?.message || "Save failed.");
      }
    } catch {
      setValue(prev);
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="Request status"
        value={value}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-[var(--attention)]">{error}</span> : null}
    </span>
  );
}
