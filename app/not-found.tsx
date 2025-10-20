// app/not-found.tsx
export const dynamic = 'force-dynamic';   // avoid static prerender
export const revalidate = 0;

export default function NotFound() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>404 — Page Not Found</h1>
      <p>Sorry, we couldn’t find that page.</p>
    </div>
  );
}
