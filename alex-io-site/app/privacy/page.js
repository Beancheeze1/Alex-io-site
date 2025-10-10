
export const metadata = { title: "Privacy — Alex-IO" };
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-slate-600">We only collect the minimum information necessary to provide Alex-IO. Contact us at support@alex-io.com with any questions.</p>
      <ul className="mt-4 list-disc pl-6 text-slate-700 space-y-1">
        <li>We don’t sell personal data.</li>
        <li>Cookies are used for basic analytics and performance.</li>
        <li>You can request deletion at any time.</li>
      </ul>
      <a className="mt-6 inline-block rounded-lg border px-4 py-2 hover:bg-slate-50" href="/">Back to home</a>
    </main>
  );
}
