// /lib/oauthStore.js
// Minimal in-memory store + optional disk persistence while developing.

import fs from "node:fs";
import path from "node:path";

const store = new Map(); // hubId -> accessToken

// Optional simple persistence across dev restarts:
const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "oauth.json");

function load() {
  try {
    const s = fs.readFileSync(FILE, "utf8");
    const obj = JSON.parse(s);
    for (const [k, v] of Object.entries(obj)) store.set(k, v);
  } catch (_) {}
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(store.entries());
    fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
  } catch (_) {}
}

load();

export function saveToken(hubId, accessToken) {
  store.set(String(hubId), accessToken);
  save();
}

export function getToken(hubId) {
  return store.get(String(hubId)) || null;
}

export function listHubs() {
  return Array.from(store.keys());
}
