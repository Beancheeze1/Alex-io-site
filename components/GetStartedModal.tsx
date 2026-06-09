"use client";

import * as React from "react";

interface Props {
  onClose: () => void;
  tier?: "Pilot" | "Starter" | "Pro" | "Shop" | "FreeTrial" | null;
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  userCount: string;
  productDescription: string;
  currentProcess: string;
  notes: string;
};

export default function GetStartedModal({ onClose, tier }: Props) {
  const [form, setForm] = React.useState<FormState>({
    name: "",
    email: "",
    phone: "",
    company: "",
    userCount: "",
    productDescription: "",
    currentProcess: "",
    notes: "",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function set(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: tier || "General inquiry",
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.company.trim() || null,
          phone: form.phone.trim() || null,
          userCount: form.userCount || null,
          productDescription: form.productDescription.trim() || null,
          currentProcess: form.currentProcess.trim() || null,
          notes: form.notes.trim() || null,
          quote_no: null,
          annual_mode: false,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data?.ok) {
        setError("Something went wrong. Please try again.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const canSubmit = form.name.trim() && form.email.trim() && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500/20 via-cyan-400/10 to-indigo-500/20 border-b border-white/10 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition"
            aria-label="Close"
          >
            ✕
          </button>
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] mb-1 ${
            tier === "FreeTrial" ? "text-emerald-300/80" : "text-sky-300/80"
          }`}>
            {tier === "FreeTrial" ? "Alex-IO · Free Trial" : "Alex-IO · Foam Quoting Software"}
          </div>
          <div className="text-lg font-bold text-white">
            {tier === "FreeTrial"
              ? "Claim your free onboarding slot"
              : "Get Alex-IO for your shop"}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {tier === "FreeTrial"
              ? "Tell us about your operation and we'll confirm your slot within one business day. We'll schedule a 45-minute setup call — you'll be quoting live before it ends. No credit card, no commitment."
              : tier
              ? `You selected the ${tier} plan. Tell us about your operation and we'll follow up within one business day with pricing and a live walkthrough.`
              : "Tell us about your operation and we'll follow up within one business day with pricing and a live walkthrough."}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {submitted ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center">
              <div className="text-2xl mb-2">✓</div>
              <div className="text-base font-semibold text-emerald-300 mb-1">
                Got it — we'll be in touch.
              </div>
              <div className="text-sm text-slate-300">
                Our team will reach out to{" "}
                <span className="text-sky-300">{form.email}</span> within one
                business day.
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Name + Email */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block col-span-2 sm:col-span-1">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                    Your name *
                  </div>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                  />
                </label>
                <label className="block col-span-2 sm:col-span-1">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                    Email *
                  </div>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="jane@yourshop.com"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                  />
                </label>
              </div>

              {/* Phone + Company */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                    Phone
                  </div>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="555-555-5555"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                  />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                    Company
                  </div>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => set("company", e.target.value)}
                    placeholder="Acme Foam Co."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                  />
                </label>
              </div>

              {/* Seats */}
              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                  How many people will use this?
                </div>
                <select
                  value={form.userCount}
                  onChange={(e) => set("userCount", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-400/50 transition"
                >
                  <option value="">Select…</option>
                  <option value="1">Just me</option>
                  <option value="2–3">2–3</option>
                  <option value="4–10">4–10</option>
                  <option value="11–25">11–25</option>
                  <option value="25+">25+</option>
                  <option value="Not sure yet">Not sure yet</option>
                </select>
              </label>

              {/* What are you packaging */}
              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                  What are you packaging?
                </div>
                <input
                  type="text"
                  value={form.productDescription}
                  onChange={(e) => set("productDescription", e.target.value)}
                  placeholder="e.g. medical devices, electronics, industrial parts"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                />
              </label>

              {/* How do you quote today */}
              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                  How do you quote today?
                </div>
                <input
                  type="text"
                  value={form.currentProcess}
                  onChange={(e) => set("currentProcess", e.target.value)}
                  placeholder="e.g. Excel, paper, competitor tool, manual"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition"
                />
              </label>

              {/* Anything else */}
              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.10em] text-slate-400">
                  Anything else?
                </div>
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Timeline, volume, specific requirements…"
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-400/50 transition resize-none"
                />
              </label>

              {error && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                  className="flex-1 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? "Sending…"
                    : tier === "FreeTrial"
                    ? "Confirm My Slot →"
                    : tier
                    ? `Request ${tier} Access →`
                    : "Get Alex-IO for my shop →"}
                </button>
              </div>
              <p className="text-center text-xs text-slate-600">
                {tier === "FreeTrial"
                  ? "No credit card · Slot confirmed within 1 business day"
                  : "Name and email required · Response within 1 business day · No commitment"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
