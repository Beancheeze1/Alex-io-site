// app/lib/internalFetch.ts
export function absoluteUrl(req: Request, path: string) {
  // Build an absolute URL that matches the current host/https
  const u = new URL(req.url);
  // path can start with / or not
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${u.protocol}//${u.host}${p}`;
}
