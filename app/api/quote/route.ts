// app/api/quote/route.ts
import { NextResponse } from "next/server";
import "server-only";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- Types
type CartItem = { sku: string; qty: number };
type PriceRule = { sku: string; min_qty: number; price: string };
type ProductRow = { sku: string; name: string; base_price: string; lead_days: number | null };

// ---- Upstash helpers (KV cache)
const UPS_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPS_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet<T = unknown>(key: string): Promise<T | null> {
  if (!UPS_URL || !UPS_TOK) return null;
  const r = await fetch(`${UPS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPS_TOK}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const js = await r.json().catch(() => null) as { result?: string } | null;
  if (!js?.result) return null;
  try { return JSON.parse(js.result) as T; } catch { return null; }
}

async function kvSet(key: string, value: unknown, ttlSec = 300) {
  if (!UPS_URL || !UPS_TOK) return;
  const body = JSON.stringify(value);
  const url = `${UPS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(body)}?EX=${ttlSec}`;
  await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${UPS_TOK}` } });
}

// ---- DB helpers
async function getProducts(skus: string[]): Promise<ProductRow[]> {
  if (skus.length === 0) return [];
  const q = `select sku, name, base_price, lead_days from products where sku = any($1)`;
  const { rows } = await pool.query<ProductRow>(q, [skus]);
  return rows;
}

async function getPriceRules(skus: string[]): Promise<PriceRule[]> {
  if (skus.length === 0) return [];
  const q = `select sku, min_qty, price from price_rules where sku = any($1) order by sku, min_qty asc`;
  const { rows } = await pool.query<PriceRule>(q, [skus]);
  return rows;
}

// choose best unit price based on qty
function resolveUnitPrice(sku: string, qty: number, base: number, rules: PriceRule[]): number {
  // get all rules for this SKU where min_qty <= qty, pick the highest min_qty
  const eligible = rules.filter(r => r.sku === sku && r.min_qty <= qty);
  if (eligible.length === 0) return base;
  const best = eligible.reduce((a, b) => (a.min_qty >= b.min_qty ? a : b));
  return Number(best.price);
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function cartCacheKey(items: CartItem[], currency: string, taxRate: number) {
  const key = items
    .map(i => `${i.sku}:${i.qty}`)
    .sort()
    .join(",");
  return `quote:${key}|${currency}|tax:${taxRate}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const items = (body.items ?? []) as CartItem[];
    const currency = (body.currency ?? "USD") as string;
    const taxRate = Number(body.taxRate ?? 0); // e.g., 0.07 for 7%
    const save = Boolean(body.save ?? false);
    const threadId = typeof body.hubspotThreadId === "string" ? body.hubspotThreadId : undefined;

    // Validate
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "items[] required: [{ sku, qty }]" }, { status: 400 });
    }
    for (const it of items) {
      if (!it?.sku || !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        return NextResponse.json({ ok: false, error: "each item needs { sku, qty>0 }" }, { status: 400 });
      }
    }

    // Cache check
    const cacheKey = cartCacheKey(items, currency, taxRate);
    const cached = await kvGet(cacheKey);
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, ...cached });
    }

    // Fetch data
    const skus = [...new Set(items.map(i => i.sku))];
    const [products, rules] = await Promise.all([getProducts(skus), getPriceRules(skus)]);

    // Build a quick lookup
    const prodMap = new Map(products.map(p => [p.sku, p]));
    const leadDays = products.reduce((max, p) => Math.max(max, p.lead_days ?? 0), 0);

    // Compute lines
    const lines = items.map(it => {
      const p = prodMap.get(it.sku);
      if (!p) {
        return {
          sku: it.sku,
          name: "(unknown SKU)",
          qty: it.qty,
          unit_price: null as number | null,
          line_total: null as number | null,
          missing: true,
        };
      }
      const base = Number(p.base_price);
      const unit = resolveUnitPrice(it.sku, Number(it.qty), base, rules);
      const lineTotal = money(unit * Number(it.qty));
      return {
        sku: it.sku,
        name: p.name,
        qty: Number(it.qty),
        unit_price: money(unit),
        line_total: lineTotal,
      };
    });

    const missing = lines.filter(l => (l as any).missing);
    if (missing.length) {
      const res = {
        currency,
        taxRate,
        lines,
        subtotal: null as number | null,
        tax: null as number | null,
        total: null as number | null,
        lead_days: leadDays || null,
        note: `Missing SKUs: ${missing.map(m => m.sku).join(", ")}`,
      };
      return NextResponse.json({ ok: false, ...res }, { status: 404 });
    }

    const subtotal = money(lines.reduce((s, l) => s + (l.line_total || 0), 0));
    const tax = money(subtotal * taxRate);
    const total = money(subtotal + tax);

    // Optional: persist quote + lines
    let quoteId: string | undefined;
    if (save) {
      const qInsert =
        `insert into quotes (hubspot_thread_id, subtotal, total)
         values ($1, $2, $3) returning id`;
      const qRes = await pool.query<{ id: string }>(qInsert, [threadId ?? null, subtotal, total]);
      quoteId = qRes.rows[0].id;

      const liInsert =
        `insert into quote_lines (quote_id, sku, qty, unit_price, line_total)
         values ($1, $2, $3, $4, $5)`;
      for (const l of lines) {
        await pool.query(liInsert, [quoteId, l.sku, l.qty, l.unit_price, l.line_total]);
      }
    }

    const payload = {
      quoteId: quoteId ?? null,
      currency,
      taxRate,
      lines,
      subtotal,
      tax,
      total,
      lead_days: leadDays || null,
    };

    // Cache briefly (5 min) for snappy repeats
    await kvSet(cacheKey, payload, 300);

    return NextResponse.json({ ok: true, cached: false, ...payload });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
