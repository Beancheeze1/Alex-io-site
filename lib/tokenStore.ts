// lib/tokenStore.ts
// File-backed, portal-aware token store.
// Compatible with the previous in-memory API so the rest of your code stays the same.

import fs from "fs";
import path from "path";

export type TokenRecord = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;   // seconds until expiry from "obtained_at"
  token_type?: string;
  obtained_at?: number;  // epoch seconds when this record was stored/refreshed
  [k: string]: any;
} | null;

const DEFAULT_KEY = "_default";

// Where to store tokens on disk.
// Override with TOKEN_STORE_PATH if you want a custom location.
const STORE_FILE =
  process.env.TOKEN_STORE_PATH ||
  path.join(process.cwd(), ".data", "tokens.json");

// In-memory cache, hydrated from disk on first use.
let cache: Record<string, TokenRecord> | null = null;

function ensureDirExists(fp: string) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore(): Record<string, TokenRecord> {
  try {
    if (cache) return cache;
    if (!fs.existsSync(STORE_FILE)) {
      cache = {};
      return cache;
    }
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    cache = raw ? (JSON.parse(raw) as Record<string, TokenRecord>) : {};
    return cache!;
  } catch {
    // On any read error, fall back to empty store (don’t blow up requests)
    cache = {};
    return cache!;
  }
}

function writeStore() {
  try {
    ensureDirExists(STORE_FILE);
    fs.writeFileSync(STORE_FILE, JSON.stringify(cache ?? {}, null, 2), "utf8");
  } catch {
    // Swallow write errors to avoid breaking routes;
    // you can log here if you wire up a logger.
  }
}

function keyOf(portal?: string | number) {
  return portal === undefined ? DEFAULT_KEY : String(portal);
}

export const tokenStore = {
  /** Save tokens under a portal (hub_id). Adds/updates obtained_at automatically. */
  save(tokens: TokenRecord, portal?: string | number) {
    const store = readStore();
    const key = keyOf(portal);
    if (tokens) {
      const now = Math.floor(Date.now() / 1000);
      const merged: NonNullable<TokenRecord> = {
        obtained_at: now,
        ...(store[key] ?? {}),
        ...tokens,
      };
      store[key] = merged;
    } else {
      store[key] = null;
    }
    writeStore();
    return key;
  },

  /** Get tokens for a portal; if none provided, uses the default slot. */
  get(portal?: string | number): TokenRecord {
    const store = readStore();
    return store[keyOf(portal)] ?? null;
  },

  /** Update a subset of fields for a portal's record. */
  update(partial: Partial<NonNullable<TokenRecord>>, portal?: string | number): TokenRecord {
    const store = readStore();
    const key = keyOf(portal);
    const curr = store[key] ?? null;
    if (!curr) {
      const now = Math.floor(Date.now() / 1000);
      const rec: NonNullable<TokenRecord> = { obtained_at: now, ...(partial as any) };
      store[key] = rec;
      writeStore();
      return rec;
    }
    const now = Math.floor(Date.now() / 1000);
    const next: NonNullable<TokenRecord> = {
      ...curr,
      ...partial,
      obtained_at: partial.access_token ? now : (curr.obtained_at ?? now),
    };
    store[key] = next;
    writeStore();
    return next;
  },

  /** Whether we have any record for a portal. */
  has(portal?: string | number) {
    const store = readStore();
    return Object.prototype.hasOwnProperty.call(store, keyOf(portal));
  },

  /** Clear a portal's record, or EVERYTHING if portal is omitted. */
  clear(portal?: string | number) {
    const store = readStore();
    if (portal === undefined) {
      cache = {};
      writeStore();
      return;
    }
    delete store[keyOf(portal)];
    writeStore();
  },

  /** List all keys currently stored. */
  listKeys(): string[] {
    const store = readStore();
    return Object.keys(store);
  },
};
