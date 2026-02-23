// lib/migrate.ts
//
// Minimal deterministic SQL migrations (no ORM, no framework).
//
// - SQL files live in /migrations/*.sql
// - Applied versions tracked in schema_migrations(version text primary key, applied_at timestamptz)
// - Deterministic order: lexicographic filename order (e.g. 001_*, 002_*)
// - Admin-only trigger via API route (see app/api/admin/migrate/route.ts)
//
// Path A: small + explicit + safe.

import fs from "fs/promises";
import path from "path";
import { withTxn } from "@/lib/db";
import type { PoolClient } from "pg";

export type MigrationInfo = {
  version: string; // filename
  applied_at?: string; // ISO-ish from DB
};

export type MigrationList = {
  ok: true;
  dir: string;
  all: string[]; // filenames
  applied: MigrationInfo[];
  pending: string[];
};

export type MigrationRun = {
  ok: true;
  dir: string;
  applied_now: string[];
  applied_total: number;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

function isSqlFile(name: string) {
  return name.toLowerCase().endsWith(".sql");
}

async function ensureSchemaMigrationsTable(tx: PoolClient) {
  await tx.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getApplied(tx: PoolClient): Promise<MigrationInfo[]> {
  const r = await tx.query<MigrationInfo>(`
    select version, applied_at::text as applied_at
    from public.schema_migrations
    order by version asc
  `);
  return r.rows || [];
}

async function getAllMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter(isSqlFile)
    .sort((a, b) => a.localeCompare(b));
  return files;
}

export async function listMigrations(): Promise<MigrationList> {
  const all = await getAllMigrationFiles();

  const applied = await withTxn(async (tx) => {
    await ensureSchemaMigrationsTable(tx);
    return getApplied(tx);
  });

  const appliedSet = new Set(applied.map((a) => a.version));
  const pending = all.filter((v) => !appliedSet.has(v));

  return {
    ok: true,
    dir: MIGRATIONS_DIR,
    all,
    applied,
    pending,
  };
}

async function readSql(version: string): Promise<string> {
  const full = path.join(MIGRATIONS_DIR, version);
  return fs.readFile(full, "utf8");
}

export async function runPendingMigrations(): Promise<MigrationRun> {
  const all = await getAllMigrationFiles();

  const applied_now = await withTxn(async (tx) => {
    await ensureSchemaMigrationsTable(tx);

    const applied = await getApplied(tx);
    const appliedSet = new Set(applied.map((a) => a.version));
    const pending = all.filter((v) => !appliedSet.has(v));

    const ran: string[] = [];

    for (const version of pending) {
      const sql = await readSql(version);

      // Execute file as-is. Keep migrations explicit and deterministic.
      // If a file contains multiple statements, node-postgres will send them as one query.
      // (Works as long as the Postgres server accepts the batch; keep files clean.)
      await tx.query(sql);

      await tx.query(
        `insert into public.schema_migrations (version) values ($1)`,
        [version],
      );

      ran.push(version);
    }

    return ran;
  });

  // total = after run
  const after = await withTxn(async (tx) => {
    await ensureSchemaMigrationsTable(tx);
    const applied = await getApplied(tx);
    return applied.length;
  });

  return {
    ok: true,
    dir: MIGRATIONS_DIR,
    applied_now,
    applied_total: after,
  };
}