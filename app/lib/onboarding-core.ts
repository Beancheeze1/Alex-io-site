// app/lib/onboarding-core.ts
//
// Step 36A: shop onboarding rules (pure: no DB, safe in the browser; tested
// in scripts/test-onboarding.ts).
//   - the "Get started" checklist: what each step is, how it's detected,
//     which steps a shop can tick (or skip) by hand
//   - starter rates: typical numbers a new shop can load with one click;
//     they only fill fields that are still 0 / empty, never overwrite
//   - invites and password resets: input checks, password rule, emails

import { escapeHtml } from "../../lib/email/send-html";

export type StepKey =
  | "shop_page"
  | "materials"
  | "foam_rates"
  | "corrugated"
  | "freight"
  | "emails_terms"
  | "staff"
  | "website"
  | "test_quote";

export type StepDef = {
  key: StepKey;
  label: string;
  detail: string;
  href: string; // "{slug}" is replaced with the shop's slug
  manual: string | null; // label of the hand tick, null = only the app can tick it
};

export const STEPS: readonly StepDef[] = [
  {
    key: "shop_page",
    label: "Your shop page",
    detail: "Logo, colors and contact details on your Quotes & ordering page. Alex-IO sets this up with you: send your logo, brand colors, phone and email.",
    href: "/t/{slug}",
    manual: null,
  },
  {
    key: "materials",
    label: "Foam material prices",
    detail: "Set your price, kerf and minimum on the materials you sell. Until you do, quotes use the catalog prices.",
    href: "/admin/materials",
    manual: "The catalog prices are fine",
  },
  {
    key: "foam_rates",
    label: "Foam cutting rates",
    detail: "CNC, steel-rule die, press and lamination rates (Pricing → Foam cutting rates).",
    href: "/admin/settings/foam", // Step 38C
    manual: "We don't cut foam",
  },
  {
    key: "corrugated",
    label: "Corrugated board and converting",
    detail: "Your board grades' $/MSF and the converting, setup, print and markup rates.",
    href: "/admin/corrugated",
    manual: "We don't sell boxes",
  },
  {
    key: "freight",
    label: "Freight",
    detail: "Your ship-from ZIP and freight table, so quotes can show freight (Pricing → Freight & shipping).",
    href: "/admin/settings/freight", // Step 38C
    manual: "We quote freight separately",
  },
  {
    key: "emails_terms",
    label: "Buyer emails and quote terms",
    detail: "Where buyer replies go, your lead time, how long quotes stay valid and which status emails go out (Shop settings → Quote terms & buyer emails).",
    href: "/admin/settings/terms", // Step 38C
    manual: "The defaults are fine",
  },
  {
    key: "staff",
    label: "Your team",
    detail: "Invite your sales, customer service and admin staff. Each gets an email to set their password.",
    href: "/admin/team", // Step 38B
    manual: "It's just me",
  },
  {
    key: "website",
    label: "Link it from your website",
    detail: "Add a \"Get a quote\" link to your shop page, or the quote widget, on your own website.",
    href: "/admin/website", // Step 38D
    manual: "Done",
  },
  {
    key: "test_quote",
    label: "Run a test quote",
    detail: "Start a quote on your shop page as a buyer would, then open it here.",
    href: "/t/{slug}",
    manual: null,
  },
];

export type Signals = {
  shop_page: boolean;
  materials: boolean;
  foam_rates: boolean;
  corrugated: boolean;
  freight: boolean;
  emails_terms: boolean;
  staff: boolean;
  website: boolean; // never detected: always false
  test_quote: boolean;
};

export type ChecklistItem = {
  key: StepKey;
  label: string;
  detail: string;
  href: string;
  done: boolean;
  how: "auto" | "manual" | null;
  manual: string | null;
};

export type Checklist = { items: ChecklistItem[]; done: number; total: number; complete: boolean };

/** Step 38E: steps for what the shop doesn't sell are left off the list. */
export type ChecklistScope = { sellsFoam?: boolean; sellsBoxes?: boolean };
const FOAM_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(["materials", "foam_rates"]);
const BOX_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(["corrugated"]);

export function checklist(signals: Signals, marked: Set<string>, slug: string, scope: ChecklistScope = {}): Checklist {
  const steps = STEPS.filter(
    (s) => !(scope.sellsFoam === false && FOAM_STEPS.has(s.key)) && !(scope.sellsBoxes === false && BOX_STEPS.has(s.key)),
  );
  const items = steps.map((s) => {
    const auto = signals[s.key] === true;
    const hand = !auto && s.manual != null && marked.has(s.key);
    return {
      key: s.key,
      label: s.label,
      detail: s.detail,
      href: s.href.replace("{slug}", encodeURIComponent(slug || "default")),
      done: auto || hand,
      how: auto ? ("auto" as const) : hand ? ("manual" as const) : null,
      manual: s.manual,
    };
  });
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === "string" && STEPS.some((s) => s.key === v);
}

export function canMark(step: StepKey): boolean {
  return STEPS.find((s) => s.key === step)?.manual != null;
}

// ---------------------------------------------------------------- starter rates

/** Foam cutting / lamination starters (Settings). Typical US job-shop numbers: check them. */
export const STARTER_FOAM: Record<string, number> = {
  cnc_setup_usd: 35,
  cnc_feed_in_per_min: 300,
  cnc_cost_per_min: 1.25,
  foam_die_over_qty: 1000,
  die_base_usd: 150,
  die_rule_per_in_usd: 1.75,
  press_setup_usd: 50,
  press_rate_per_hr: 85,
  press_hits_per_hr: 600,
  lam_setup_usd: 25,
  lam_per_glue_line_usd: 0.15,
};

/** Corrugated run / print rates (Admin → Corrugated). */
export const STARTER_CORRUGATED: Record<string, number> = {
  waste_pct: 8,
  order_setup_usd: 75,
  converting_per_m: 120,
  plate_spot_usd: 150,
  plate_flood_usd: 300,
  print_setup_per_color_usd: 40,
  print_run_spot_per_m: 25,
  print_run_flood_per_m: 45,
  markup_pct: 35,
  min_order_usd: 150,
  diecut_per_m: 180,
  die_base_usd: 250,
  die_per_in_usd: 1.5,
  pad_per_m: 40,
  partition_per_m: 250,
};

/** Board cost $/MSF by the default grade names (lib/corrugated-blank.ts DEFAULT_GRADES). */
export const STARTER_GRADE_MSF: Record<string, number> = {
  "32 ECT E": 100,
  "32 ECT C": 90,
  "44 ECT C": 115,
  "32 ECT B": 90,
  "44 ECT BC": 165,
  "51 ECT BC": 190,
};

const empty = (v: unknown) => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) === 0;

/** Only the starter fields that are still 0 / empty in `current`. */
export function starterPatch(current: Record<string, unknown>, starter: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(starter)) if (empty(current[k])) out[k] = v;
  return out;
}

/** Grades without a $/MSF that have a starter price, by name. */
export function starterGrades(grades: { id: number; name: string; cost_per_msf: number | null }[]): { id: number; cost_per_msf: number }[] {
  return grades
    .filter((g) => empty(g.cost_per_msf) && STARTER_GRADE_MSF[g.name] != null)
    .map((g) => ({ id: g.id, cost_per_msf: STARTER_GRADE_MSF[g.name] }));
}

// ---------------------------------------------------------------- invites

export const INVITE_DAYS = 7;
export const RESET_MINUTES = 60;
export const MIN_PASSWORD = 10;
// Step 36B: "viewer" retired (it could open nothing). Old viewer accounts land on /no-access.
export const ROLES = ["admin", "cs", "sales"] as const;
export type Role = (typeof ROLES)[number];

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Pick a password that isn't one repeated character.";
  return null;
}

export type InviteInput = { email: string; name: string; role: Role; sales_slug: string | null };

export function cleanInvite(raw: unknown): { ok: true; value: InviteInput } | { ok: false; field: string; message: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(email) || email.length > 200) {
    return { ok: false, field: "email", message: "Enter a valid email address." };
  }
  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!name) return { ok: false, field: "name", message: "Enter their name." };
  const role = typeof b.role === "string" ? b.role.trim().toLowerCase() : "";
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, field: "role", message: "Role must be admin, cs or sales." };
  const slugRaw = typeof b.sales_slug === "string" ? b.sales_slug.trim().toLowerCase() : "";
  if (slugRaw && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(slugRaw)) {
    return { ok: false, field: "sales_slug", message: "Sales slug: lowercase letters, numbers and hyphens." };
  }
  return { ok: true, value: { email, name, role: role as Role, sales_slug: slugRaw || null } };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** "You're invited" (kind invite) or "Reset your password" (kind reset). */
export function accessEmail(d: {
  kind: "invite" | "reset";
  brand: string;
  name: string | null;
  link: string;
  invitedBy?: string | null;
  primaryColor?: string | null;
  onPrimary?: string | null;
  logoUrl?: string | null;
}): { subject: string; html: string } {
  const e = escapeHtml;
  const primary = d.primaryColor && HEX.test(d.primaryColor) ? d.primaryColor : "#2B2B28";
  const onPrimary = d.onPrimary && HEX.test(d.onPrimary) ? d.onPrimary : "#FFFFFF";
  const logo =
    d.logoUrl && /^https:\/\//i.test(d.logoUrl)
      ? `<img src="${e(d.logoUrl)}" alt="${e(d.brand)}" style="max-height:40px;max-width:200px;display:block">`
      : `<div style="font-size:16px;font-weight:700;color:#1c1c1a">${e(d.brand)}</div>`;
  const p = (s: string) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#33332f">${e(s)}</p>`;
  const hi = `Hi ${d.name && d.name.trim() ? d.name.trim() : "there"},`;
  const invite = d.kind === "invite";
  const heading = invite ? `You're invited to ${d.brand} on Alex-IO` : "Reset your password";
  const paras = invite
    ? [
        hi,
        `${d.invitedBy ? `${d.invitedBy} invited you` : "You've been invited"} to ${d.brand}'s quoting and order system on Alex-IO.`,
        `Set your password to sign in. The link works once, for ${INVITE_DAYS} days.`,
      ]
    : [hi, `Someone (hopefully you) asked to reset your ${d.brand} password on Alex-IO.`, `The link works once, for ${RESET_MINUTES} minutes. If you didn't ask, ignore this email: your password stays the same.`];
  const html = [
    `<div style="background:#f6f6f4;padding:24px 8px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1c1a">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px">`,
    `<tr><td style="padding:18px 24px;border-bottom:3px solid ${primary}">${logo}</td></tr>`,
    `<tr><td style="padding:24px">`,
    `<h1 style="font-size:19px;line-height:1.3;margin:0 0 14px;color:#1c1c1a">${e(heading)}</h1>`,
    ...paras.map(p),
    `<a href="${e(d.link)}" style="display:inline-block;background:${primary};color:${onPrimary};text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${invite ? "Set your password" : "Choose a new password"}</a>`,
    `</td></tr>`,
    `<tr><td style="padding:14px 24px;border-top:1px solid #eeeeea;font-size:12px;color:#6b6b66">${e(d.brand)} · Alex-IO</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");
  return { subject: invite ? `${d.brand}: you're invited to Alex-IO` : `${d.brand}: reset your password`, html };
}
