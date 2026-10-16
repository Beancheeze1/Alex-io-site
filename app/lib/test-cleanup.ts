// app/lib/test-cleanup.ts
//
// Step 36B: delete QA test quotes by number (rules in
// app/lib/test-cleanup-core.ts). Platform owner only (the route checks).
//   previewTestQuotes(): what would go: the quotes, rows per table, rows
//                        that stay, money records that block the run
//   deleteTestQuotes():  the same, then deletes it all in ONE transaction
//                        (all or nothing) and forgets the quotes' facts
// The tables that point at a quote are read from the database's own column
// list, so new quote tables are covered without changing this file.

import type { PoolClient } from "pg";
import { withTxn } from "@/lib/db";
import { forgetFacts } from "@/app/lib/memory";
import {
  QUOTE_COLUMNS,
  confirmPhrase,
  groupColumns,
  isDeletableTable,
  isProtectedTable,
  isSkippedTable,
  parseQuoteNos,
  phraseMatches,
  totalByTable,
  type Preview,
  type QuoteColumn,
  type QuotePreview,
  type TableHit,
} from "@/app/lib/test-cleanup-core";


const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function quoteTables(db: PoolClient): Promise<{ table: string; columns: QuoteColumn[] }[]> {
  const r = await db.query<{ table_name: string; column_name: QuoteColumn }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = ANY($1::text[])
      ORDER BY c.table_name, c.column_name`,
    [QUOTE_COLUMNS as unknown as string[]],
  );
  return groupColumns(r.rows.filter((x) => !isSkippedTable(x.table_name)).map((x) => ({ table: x.table_name, column: x.column_name })));
}

async function findQuotes(db: PoolClient, quoteNos: string[]): Promise<QuotePreview[]> {
  const r = await db.query<{
    id: number;
    quote_no: string;
    tenant_id: number;
    shop: string | null;
    customer: string | null;
    status: string | null;
    locked: boolean | null;
    created_at: string;
  }>(
    `SELECT qq.id, qq.quote_no, qq.tenant_id, t.name AS shop, qq.customer_name AS customer, qq.status,
            COALESCE((to_jsonb(qq) ->> 'locked')::boolean, false) AS locked, qq.created_at
       FROM public.quotes qq LEFT JOIN public.tenants t ON t.id = qq.tenant_id
      WHERE upper(qq.quote_no) = ANY($1::text[])
      ORDER BY qq.created_at`,
    [quoteNos],
  );
  const found = r.rows.map((x) => ({ ...x, id: Number(x.id), tenant_id: Number(x.tenant_id), locked: !!x.locked }));
  // Reorders copied from these quotes that are not themselves in the list.
  const re = await db
    .query<{ quote_no: string; reorder_of: string }>(
      `SELECT quote_no, (to_jsonb(qq) ->> 'reorder_of') AS reorder_of FROM public.quotes qq
        WHERE upper(to_jsonb(qq) ->> 'reorder_of') = ANY($1::text[])`,
      [found.map((f) => f.quote_no.toUpperCase())],
    )
    .then((x) => x.rows)
    .catch(() => [] as { quote_no: string; reorder_of: string }[]);
  const listed = new Set(quoteNos);
  return found.map((f) => ({
    ...f,
    created_at: new Date(f.created_at).toISOString(),
    reorders: re
      .filter((x) => String(x.reorder_of).toUpperCase() === f.quote_no.toUpperCase() && !listed.has(x.quote_no.toUpperCase()))
      .map((x) => x.quote_no),
  }));
}

/**
 * Step 36C: one WHERE over all of a table's quote columns, so a row with both
 * is counted / deleted once. Returns the SQL and only the parameters it uses.
 */
function match(columns: QuoteColumn[], ids: string[], nos: string[]): { where: string; params: string[][] } {
  const params: string[][] = [];
  const parts = columns.map((c) => {
    params.push(c === "quote_id" ? ids : nos);
    return `${ident(c)}::text = ANY($${params.length}::text[])`;
  });
  return { where: parts.join(" OR "), params };
}

async function countHits(db: PoolClient, tables: { table: string; columns: QuoteColumn[] }[], ids: string[], nos: string[]): Promise<TableHit[]> {
  const hits: TableHit[] = [];
  if (!ids.length) return hits;
  for (const t of tables) {
    const m = match(t.columns, ids, nos);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${ident(t.table)} WHERE ${m.where}`, m.params);
    const n = Number(r.rows[0]?.n) || 0;
    if (n > 0) hits.push({ table: t.table, columns: t.columns, rows: n });
  }
  return hits;
}

async function build(db: PoolClient, text: unknown): Promise<{ preview: Preview; hits: TableHit[]; quotes: QuotePreview[] } | { error: string }> {
  const p = parseQuoteNos(text);
  if (p.tooMany) return { error: "Up to 200 quotes per run." };
  if (!p.quoteNos.length) return { error: p.invalid.length ? "None of those look like quote numbers." : "Paste one or more quote numbers." };
  const quotes = await findQuotes(db, p.quoteNos);
  const foundNos = new Set(quotes.map((x) => x.quote_no.toUpperCase()));
  const tables = await quoteTables(db);
  const hits = await countHits(
    db,
    tables,
    quotes.map((x) => String(x.id)),
    quotes.map((x) => x.quote_no),
  );
  const preview: Preview = {
    quotes,
    not_found: p.quoteNos.filter((n) => !foundNos.has(n)),
    invalid: p.invalid,
    tables: totalByTable(hits.filter((h) => isDeletableTable(h.table))),
    kept: totalByTable(hits.filter((h) => !isDeletableTable(h.table) && !isProtectedTable(h.table))),
    blocked: totalByTable(hits.filter((h) => isProtectedTable(h.table))),
    confirm: confirmPhrase(quotes.length),
  };
  return { preview, hits, quotes };
}

export async function previewTestQuotes(text: unknown): Promise<{ ok: true; preview: Preview } | { ok: false; message: string }> {
  // Read-only: runs in a transaction only so every count sees the same data.
  const r = await withTxn((tx) => build(tx, text));
  if ("error" in r) return { ok: false, message: r.error };
  return { ok: true, preview: r.preview };
}

export type DeleteResult =
  | { ok: true; deleted: { quotes: number; rows: { table: string; rows: number }[] }; quote_nos: string[] }
  | { ok: false; status: number; error: string; message: string; preview?: Preview };

export async function deleteTestQuotes(text: unknown, typed: unknown, by: string): Promise<DeleteResult> {
  const out = await withTxn(async (tx): Promise<DeleteResult> => {
    const r = await build(tx, text);
    if ("error" in r) return { ok: false, status: 400, error: "invalid_input", message: r.error };
    const { preview, hits, quotes } = r;
    if (!quotes.length) return { ok: false, status: 404, error: "not_found", message: "None of those quotes exist.", preview };
    if (preview.blocked.length) {
      return {
        ok: false,
        status: 409,
        error: "money_records",
        message: "Some of these quotes have commission / expense records. Remove those quotes from the list.",
        preview,
      };
    }
    if (!phraseMatches(typed, quotes.length)) {
      return { ok: false, status: 400, error: "confirm", message: `Type ${preview.confirm} to confirm.`, preview };
    }
    const ids = quotes.map((x) => String(x.id));
    const nos = quotes.map((x) => x.quote_no);
    const deleted: TableHit[] = [];
    // Tables can point at each other (a proof at an attachment…), so a delete
    // that a foreign key refuses is retried after the others, up to 4 passes.
    let pending = hits.filter((x) => isDeletableTable(x.table));
    for (let pass = 0; pass < 4 && pending.length; pass++) {
      const next: TableHit[] = [];
      for (const h of pending) {
        await tx.query("SAVEPOINT cleanup_row");
        try {
          const m = match(h.columns, ids, nos);
          const d = await tx.query(`DELETE FROM public.${ident(h.table)} WHERE ${m.where}`, m.params);
          await tx.query("RELEASE SAVEPOINT cleanup_row");
          deleted.push({ table: h.table, columns: h.columns, rows: d.rowCount || 0 });
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT cleanup_row");
          if ((e as { code?: string } | null)?.code !== "23503") throw e;
          next.push(h);
        }
      }
      pending = next;
    }
    if (pending.length) throw new Error(`Couldn't delete from ${pending.map((h) => h.table).join(", ")} (linked records).`);
    const dq = await tx.query(`DELETE FROM public.quotes WHERE id::text = ANY($1::text[])`, [ids]);
    console.info("[test-cleanup] deleted test quotes", { by, quotes: nos, rows: totalByTable(deleted) });
    return { ok: true, deleted: { quotes: dq.rowCount || 0, rows: totalByTable(deleted) }, quote_nos: nos };
  });
  if (out.ok) {
    for (const n of out.quote_nos) await forgetFacts(n).catch(() => undefined);
  }
  return out;
}
