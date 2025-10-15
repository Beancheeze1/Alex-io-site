// app/tailwind-test/page.js
export default function TailwindTest() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">
              Tailwind Sanity Check
            </h1>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
              should look green
            </span>
          </div>

          <p className="mt-3 text-gray-600">
            If you see rounded corners, a light shadow, and gray text here,
            Tailwind is loading correctly.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button className="rounded-xl bg-black px-4 py-2 text-white transition hover:opacity-80 active:scale-95">
              Primary Button
            </button>
            <button className="rounded-xl border px-4 py-2 text-gray-800 hover:bg-gray-100">
              Ghost Button
            </button>
            <button className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-white">
              Gradient
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <div className="text-sm uppercase text-gray-500">Typography</div>
              <div className="mt-2 space-y-1">
                <div className="text-lg font-medium">Heading</div>
                <div className="text-gray-600">Body / muted text</div>
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm uppercase text-gray-500">Utility</div>
              <div className="mt-2">
                <div className="h-2 w-full rounded bg-gray-200">
                  <div className="h-2 w-1/2 rounded bg-emerald-500"></div>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-xs text-gray-400">
            Try resizing the window — the two cards above should stack on mobile
            and split 2-column on larger screens.
          </p>
        </div>
      </div>
    </main>
  );
}
