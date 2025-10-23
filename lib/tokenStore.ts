// lib/tokenStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TokenRecord = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  obtained_at?: number;
  hubId?: number | null;
  [k: string]: unknown;
};

type StoreShape = { default?: TokenRecord; [portal: string]: TokenRecord | undefined };

const DATA_DIR = join(process.cwd(), ".data");
const FILE = join(DATA_DIR, "tokens.json");

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({}, null, 2));
}
function load(): StoreShape {
  ensureFile();
  try { return JSON.parse(readFileSync(FILE, "utf8") || "{}") as StoreShape; }
  catch { return {}; }
}
function save(obj: StoreShape) { ensureFile(); writeFileSync(FILE, JSON.stringify(obj, null, 2)); }
function keyFor(portal?: number) { return typeof portal === "number" && Number.isFinite(portal) ? String(portal) : "default"; }

export const tokenStore = {
  set(token: TokenRecord, portal?: number) {
    const all = load(); const k = keyFor(portal ?? token.hubId ?? undefined);
    all[k] = { ...(all[k] || {}), ...token, hubId: token.hubId ?? (portal ?? null) }; save(all);
  },
  get(portal?: number): TokenRecord | undefined {
    const all = load(); const k = keyFor(portal); return all[k] || all["default"];
  },
  listKeys(): string[] { return Object.keys(load()); },
  clear(portal?: number) {
    if (typeof portal === "number") { const all = load(); delete all[String(portal)]; save(all); }
    else save({});
  }
};
