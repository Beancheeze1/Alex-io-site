// app/tailwind-test/page.jsx
export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center p-10 bg-gray-50">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Tailwind OK</h1>
        <p className="mt-2 text-gray-600">
          If this looks styled (rounded card, gray background), Tailwind is working.
        </p>
        <button className="mt-4 rounded-xl bg-black px-4 py-2 text-white hover:opacity-80 active:scale-95">
          Test Button
        </button>
      </div>
    </main>
  );
}
