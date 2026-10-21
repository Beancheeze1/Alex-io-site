// lib/embed-host.ts
//
// Step 38D2: a shop's public host, shared by the server Website page and
// the client embed snippet card. (It used to live in the "use client"
// EmbedSnippetCard; calling it from the server page crashed that page.)

export function buildEmbedHost(slug: string): string {
  // "default" is the core/root tenant slug (no subdomain prefix) — same
  // convention used by lib/tenant.ts for resolving the core host.
  return slug === "default" ? "api.alex-io.com" : `${slug}.api.alex-io.com`;
}
