// components/admin/ShopPageEditor.tsx
//
// Step 45: Shop settings → Shop page. Loads the shop's page fields from
// GET /api/admin/shop-page and saves only the fields changed here
// (POST /api/admin/shop-page { changes }), so another admin's change to a
// different field is never undone. Each field says where it shows on the page.
// Step 46: "Upload a file" for the logo and banner photo (saved right away,
// POST /api/admin/shop-page/upload).
// Step 47: "What buyers can quote online" sets the shop's quote types (the
// quoting tools and the page's product tiles), with notes on what still needs
// prices.

"use client";

import * as React from "react";
import {
  REQUIRED_PAIR_NOTE,
  SHOP_PAGE_FIELDS,
  pricingWarnings,
  type PricingReady,
  STAT_MAX,
  shopPageChanges,
  type ShopPageValues,
  type ShopStat,
} from "@/lib/shop-page-edit";
import { PRODUCT_INFO, productsForQuoteTypes } from "@/lib/tenant-products";
import { QUOTE_TYPE_KEYS, QUOTE_TYPE_LABELS } from "@/lib/quote-types";
import { useRouter } from "next/navigation";

type Loaded = {
  slug: string;
  brandName: string;
  page_url: string;
  pricing: PricingReady; // Step 47
  values: ShopPageValues;
};

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]";

function padStats(stats: ShopStat[]): ShopStat[] {
  const rows = stats.slice(0, 4).map((s) => ({ ...s }));
  while (rows.length < 4) rows.push({ label: "", value: "" });
  return rows;
}

function Section({ title, where, children }: { title: string; where: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <h2 className="text-base font-medium text-[var(--text-primary)]">{title}</h2>
      <p className="mb-4 mt-1 text-xs text-[var(--text-muted)]">{where}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-[var(--text-secondary)]">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div> : null}
      {error ? (
        <div className="mt-1 text-xs font-medium text-[var(--attention)]" data-shop-page-error>
          {error}
        </div>
      ) : null}
    </label>
  );
}

export default function ShopPageEditor() {
  const router = useRouter(); // Step 47
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [form, setForm] = React.useState<ShopPageValues | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [uploading, setUploading] = React.useState<"logo" | "banner" | null>(null); // Step 46

  const apply = (j: Loaded) => {
    setLoaded(j);
    setForm({ ...j.values, stats: padStats(j.values.stats) });
  };

  React.useEffect(() => {
    fetch("/api/admin/shop-page", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) apply(j as Loaded);
        else setLoadError(j?.message || "Couldn't load your shop page settings.");
      })
      .catch(() => setLoadError("Couldn't load your shop page settings."));
  }, []);

  const changes = React.useMemo(
    () => (form && loaded ? shopPageChanges(form, loaded.values) : {}),
    [form, loaded],
  );
  const dirty = Object.keys(changes).length > 0;

  // warn before leaving with unsaved changes
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (loadError) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--attention)]">{loadError}</div>;
  }
  if (!form || !loaded) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  const set = <K extends keyof ShopPageValues>(k: K, v: ShopPageValues[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setMsg(null);
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: "" }));
  };

  const text = (k: keyof typeof SHOP_PAGE_FIELDS, opts: { hint?: string; placeholder?: string; area?: number } = {}) => {
    const spec = SHOP_PAGE_FIELDS[k];
    const v = String(form[k as keyof ShopPageValues] ?? "");
    const max = spec.kind === "text" ? spec.max : undefined;
    return (
      <Field
        label={spec.label}
        hint={[opts.hint, max ? `${v.length} / ${max}` : ""].filter(Boolean).join(" · ") || undefined}
        error={errors[k]}
      >
        {opts.area ? (
          <textarea
            rows={opts.area}
            value={v}
            placeholder={opts.placeholder}
            onChange={(e) => set(k as keyof ShopPageValues, e.target.value as never)}
            className={inputCls}
            data-shop-page-field={k}
          />
        ) : (
          <input
            value={v}
            placeholder={opts.placeholder}
            onChange={(e) => set(k as keyof ShopPageValues, e.target.value as never)}
            className={inputCls}
            data-shop-page-field={k}
          />
        )}
      </Field>
    );
  };

  const color = (k: "primaryColor" | "secondaryColor", hint: string) => {
    const v = form[k];
    const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
    return (
      <Field label={SHOP_PAGE_FIELDS[k].label} hint={hint} error={errors[k]}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${SHOP_PAGE_FIELDS[k].label} picker`}
            value={valid && v.length === 7 ? v : "#2B2B28"}
            onChange={(e) => set(k, e.target.value.toUpperCase())}
            className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-[var(--surface-card)]"
          />
          <input
            value={v}
            placeholder="#1060A0 (blank = standard)"
            onChange={(e) => set(k, e.target.value)}
            className={`${inputCls} max-w-[220px] font-mono`}
            data-shop-page-field={k}
          />
        </div>
      </Field>
    );
  };

  const toggle = (k: "heroUseLogo" | "landingChatEnabled", hint: string) => (
    <label className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
      <input
        type="checkbox"
        checked={form[k]}
        onChange={(e) => set(k, e.target.checked)}
        className="mt-0.5"
        data-shop-page-field={k}
      />
      <span>
        <span className="font-medium text-[var(--text-primary)]">{SHOP_PAGE_FIELDS[k].label}</span>
        <span className="block text-xs text-[var(--text-muted)]">{hint}</span>
      </span>
    </label>
  );

  // Step 46: upload a logo / banner file. It's saved right away and the field
  // shows the file's address (not counted as an unsaved change).
  const upload = async (kind: "logo" | "banner", file: File | null) => {
    if (!file) return;
    const field = kind === "logo" ? "logoUrl" : "heroImageUrl";
    setUploading(kind);
    setMsg(null);
    setErrors((e) => ({ ...e, [field]: "" }));
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const res = await fetch("/api/admin/shop-page/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setErrors((e) => ({ ...e, [field]: j?.message || "Couldn't upload that file." }));
        return;
      }
      const url = String(j.url);
      setLoaded((l) => (l ? { ...l, values: { ...l.values, [field]: url } } : l));
      setForm((f) => (f ? { ...f, [field]: url } : f));
      setMsg({ ok: true, text: kind === "logo" ? "Logo uploaded and saved." : "Banner photo uploaded and saved." });
    } catch {
      setErrors((e) => ({ ...e, [field]: "Couldn't upload that file." }));
    } finally {
      setUploading(null);
    }
  };

  const uploadButton = (kind: "logo" | "banner") => (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
      <label
        className={`inline-flex cursor-pointer items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        {uploading === kind ? "Uploading…" : kind === "logo" ? "Upload a logo file" : "Upload a photo"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={!!uploading}
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            e.target.value = "";
            void upload(kind, f);
          }}
          data-shop-page-upload={kind}
        />
      </label>
      <span>
        {kind === "logo" ? "PNG, JPG or WebP up to 1 MB. A square or wide logo with a transparent background looks best." : "PNG, JPG or WebP up to 6 MB, at least 1600 px wide."} Saved as soon as it uploads.
      </span>
    </div>
  );

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setMsg(null);
    setErrors({});
    try {
      const res = await fetch("/api/admin/shop-page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        if (j?.errors) setErrors(j.errors as Record<string, string>);
        setMsg({ ok: false, text: j?.message || "Couldn't save. Nothing was changed." });
        return;
      }
      apply(j as Loaded);
      setMsg({ ok: true, text: "Saved. Your page shows the changes now." });
      // Step 47: the admin menus follow the quote types (e.g. foam pricing pages)
      if ("quoteTypes" in changes) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Couldn't save. Nothing was changed." });
    } finally {
      setSaving(false);
    }
  };

  // Step 47: what still needs prices for the quote types picked
  const warnings = pricingWarnings(form.quoteTypes, loaded.pricing);

  return (
    <div data-shop-page-editor>
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-sm">
        <span className="text-[var(--text-secondary)]">Your page:</span>
        <a
          href={loaded.page_url}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-[var(--action-primary)] hover:underline"
          data-shop-page-link
        >
          {loaded.page_url} ↗
        </a>
        <span className="text-xs text-[var(--text-muted)]">
          Name on the page: {loaded.brandName} (ask Alex-IO to change it)
        </span>
      </div>

      <Section title="Header and colors" where="The top of every section of your page: the bar, the header with your name or logo, the buttons and the footer.">
        {text("logoUrl", { placeholder: "https://…/logo.png", hint: "Upload your logo below, or paste a link to it." })}
        {uploadButton("logo")}
        {form.logoUrl && /^https?:\/\//i.test(form.logoUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.logoUrl} alt="Logo preview" className="h-11 w-auto max-w-[220px] rounded border border-[var(--border)] bg-white object-contain p-1" />
        ) : null}
        {toggle("heroUseLogo", "On: the header shows the logo in place of your name and tagline. Off: your initials, name and tagline.")}
        {text("tagline", { placeholder: "Family-owned box makers since 1971", hint: "Under your name in the header (when the logo isn't shown)." })}
        {color("primaryColor", "Buttons like Start an online quote and Request a quote.")}
        {color("secondaryColor", "The thin bar at the very top, the footer, and the banner when there's no photo.")}
      </Section>

      <Section title="Banner" where="The big area at the top with the Quotes & ordering headline.">
        {text("heroImageUrl", { placeholder: "https://…/plant.jpg", hint: "A wide photo (your plant or shop floor), shown with a dark fade so the headline stays readable. Upload it below, or paste a link." })}
        {uploadButton("banner")}
        {form.heroImageUrl && /^https?:\/\//i.test(form.heroImageUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.heroImageUrl} alt="Banner preview" className="h-24 w-full rounded border border-[var(--border)] object-cover" />
        ) : null}
        {text("heroCaption", { placeholder: "Our Wooster, Ohio plant", hint: "Small text at the bottom right of the photo." })}
        {text("quoteIntro", { area: 3, hint: "Under the headline. Blank = \"Price … online any time, or talk to our team about anything custom.\"" })}
        {text("quoteScope", { placeholder: "standard box styles and mailers", hint: "Used in the Quote online card: \"Build a quote for … yourself.\"" })}
      </Section>

      <Section
        title="What buyers can quote online"
        where="Turns your quoting tools on or off (the quote forms, the chat and the editor), and sets the product tiles under the cards on your page."
      >
        <Field label="Quote types" error={errors.quoteTypes}>
          <div className="space-y-2">
            {QUOTE_TYPE_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={form.quoteTypes.includes(k)}
                  onChange={(e) =>
                    set(
                      "quoteTypes",
                      e.target.checked ? [...form.quoteTypes.filter((t) => t !== k), k] : form.quoteTypes.filter((t) => t !== k),
                    )
                  }
                  className="mt-0.5"
                  data-shop-page-quote-type={k}
                />
                <span>
                  <span className="font-medium text-[var(--text-primary)]">{QUOTE_TYPE_LABELS[k]}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    Tiles: {productsForQuoteTypes([k]).map((p) => PRODUCT_INFO[p].label).join(", ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        {form.quoteTypes.length === 0 ? (
          <div className="text-xs font-medium text-[var(--attention)]" data-shop-page-types-none>
            Pick at least one, or buyers can&apos;t quote anything online.
          </div>
        ) : null}
        {warnings.length ? (
          <ul className="space-y-1 rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-xs text-[var(--attention)]" data-shop-page-pricing-warnings>
            {warnings.map((w) => (
              <li key={w.href}>
                {w.text}{" "}
                <a href={w.href} className="font-medium underline">
                  {w.link}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="text-xs text-[var(--text-muted)]">
          Turning a type off hides it from your quote forms and stops new quotes of that type. Quotes you already have
          aren&apos;t changed.
        </div>
      </Section>

      <Section title="About" where={`The About ${loaded.brandName} section: your text on the left, up to 4 stats in a box on the right.`}>
        {text("aboutText", { area: 6, hint: "2–3 sentences: how you started, what you do today. Line breaks are kept." })}
        {text("websiteUrl", { placeholder: "https://www.yourshop.com", hint: "\"← yourshop.com\" in the top bar, Home in the banner, and links in About and the footer." })}
        <Field label="Stats (number + label)" hint={`Each up to ${STAT_MAX} characters. ${REQUIRED_PAIR_NOTE}`} error={errors.stats}>
          <div className="space-y-2">
            {form.stats.map((st, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr] gap-2">
                <input
                  value={st.value}
                  placeholder={i === 0 ? "50+" : ""}
                  onChange={(e) => set("stats", form.stats.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                  className={inputCls}
                  aria-label={`Stat ${i + 1} number`}
                  data-shop-page-stat-value={i}
                />
                <input
                  value={st.label}
                  placeholder={i === 0 ? "years in business" : ""}
                  onChange={(e) => set("stats", form.stats.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                  className={inputCls}
                  aria-label={`Stat ${i + 1} label`}
                  data-shop-page-stat-label={i}
                />
              </div>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Contact" where="A Talk to our team card (phone or email), the top bar (phone, hours) and the contact row near the bottom.">
        {text("phone", { placeholder: "(419) 555-0100" })}
        {text("email", { placeholder: "quotes@yourshop.com", hint: "Shown on the page, with an Email us button." })}
        {text("address", { placeholder: "123 Main St, Ashland, OH 44805", hint: "Shown as Plant in the contact row." })}
        {text("hours", { placeholder: "Mon–Fri, 7:00 am – 4:30 pm" })}
        {text("specsEmail", { placeholder: "estimating@yourshop.com", hint: "Not shown on the page: Send us your specs requests are emailed here (blank = the public contact email)." })}
      </Section>

      <Section title="Chat" where="The Get a quote by chat button at the bottom right of the page.">
        {toggle("landingChatEnabled", "Buyers can describe what they need in a chat; it gathers the details and opens the quote form.")}
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-page)] px-4 py-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-md bg-[var(--action-primary)] px-5 py-2 text-sm font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
          data-shop-page-save
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => {
            apply(loaded);
            setErrors({});
            setMsg(null);
          }}
          disabled={!dirty || saving}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
          data-shop-page-undo
        >
          Undo changes
        </button>
        <span className="text-xs text-[var(--text-muted)]">
          {dirty ? `${Object.keys(changes).length} unsaved change${Object.keys(changes).length === 1 ? "" : "s"}` : "No unsaved changes"}
        </span>
        {msg ? (
          <span className={`text-sm font-medium ${msg.ok ? "text-[var(--status-success-text)]" : "text-[var(--attention)]"}`} data-shop-page-msg>
            {msg.text}{" "}
            {msg.ok ? (
              <a href={loaded.page_url} target="_blank" rel="noreferrer" className="underline">
                View your page ↗
              </a>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
