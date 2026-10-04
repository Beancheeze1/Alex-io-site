// components/tenant/SpecRequestForm.tsx
//
// "Send us your specs" form. Posts multipart/form-data to
// /api/public/spec-request. Client-side checks mirror the server limits.
"use client";

import * as React from "react";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.dxf,.dwg,.step,.stp,.igs,.iges,.stl";
const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export default function SpecRequestForm({
  tenantSlug,
  brandName,
  primaryColor,
  onPrimary,
  backHref,
  salesRepSlug,
}: {
  tenantSlug: string;
  brandName: string;
  primaryColor: string;
  onPrimary: string;
  backHref: string;
  /** Rep attribution from the page URL (?sales_rep_slug=), sent with the form. */
  salesRepSlug?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("tenant", tenantSlug);
    if (salesRepSlug) fd.set("sales_rep_slug", salesRepSlug);

    const files = (fd.getAll("files") as File[]).filter((f) => f && f.size > 0);
    if (files.length > MAX_FILES) return setError(`Attach up to ${MAX_FILES} files.`);
    if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) {
      return setError("Files must total 8 MB or less. For larger files, email us directly.");
    }
    if (!String(fd.get("notes") || "").trim() && files.length === 0) {
      return setError("Attach a file or describe what you need.");
    }

    setBusy(true);
    try {
      const res = await fetch("/api/public/spec-request", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setDone(true);
        form.reset();
        return;
      }
      setError(
        res.status === 429
          ? "Too many submissions. Please wait a minute and try again."
          : typeof data?.message === "string"
            ? data.message
            : "We couldn't send your request. Please try again or email us directly.",
      );
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--border-strong)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
  };
  const labelCls = "block text-sm";
  const inputCls = "mt-1 block w-full rounded-md px-3 py-2.5 text-[15px]";

  if (done) {
    return (
      <div className="rounded-xl p-7" style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}>
        <h2 className="mb-2 text-xl font-medium">Specs received</h2>
        <p className="mb-5" style={{ color: "var(--text-secondary)" }}>
          Thanks — {brandName} has your request and will be in touch about your quote. We also sent a confirmation to your email.
        </p>
        <a href={backHref} className="font-medium hover:underline">← Back to Quotes &amp; ordering</a>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4 rounded-xl p-7"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelCls} style={{ color: "var(--text-muted)" }}>
          Name *
          <input name="name" required autoComplete="name" className={inputCls} style={inputStyle} />
        </label>
        <label className={labelCls} style={{ color: "var(--text-muted)" }}>
          Email *
          <input name="email" type="email" required autoComplete="email" className={inputCls} style={inputStyle} />
        </label>
        <label className={labelCls} style={{ color: "var(--text-muted)" }}>
          Company
          <input name="company" autoComplete="organization" className={inputCls} style={inputStyle} />
        </label>
        <label className={labelCls} style={{ color: "var(--text-muted)" }}>
          Phone
          <input name="phone" type="tel" autoComplete="tel" className={inputCls} style={inputStyle} />
        </label>
      </div>

      <label className={labelCls} style={{ color: "var(--text-muted)" }}>
        What do you need?
        <textarea
          name="notes"
          rows={5}
          placeholder="Part size and weight, quantity, how it ships, any material you have in mind…"
          className={inputCls}
          style={inputStyle}
        />
      </label>

      <label className={labelCls} style={{ color: "var(--text-muted)" }}>
        Drawings, photos or CAD files (up to 3 files, 8 MB total)
        <input name="files" type="file" multiple accept={ACCEPT} className="mt-1 block w-full text-[15px]" />
        <span className="mt-1 block text-xs" style={{ color: "var(--text-faint)" }}>
          PDF, image, DXF, DWG, STEP, IGES or STL
        </span>
      </label>

      {/* Honeypot: hidden from people, filled by bots */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm" style={{ color: "var(--attention)" }}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[48px] items-center justify-center self-start rounded-md px-6 text-[15px] font-medium disabled:opacity-50"
        style={{ background: primaryColor, color: onPrimary }}
      >
        {busy ? "Sending…" : "Send specs"}
      </button>
    </form>
  );
}
