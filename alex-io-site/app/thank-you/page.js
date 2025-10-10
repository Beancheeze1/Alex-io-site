
export const metadata = { title: "Thank you — Alex-IO" };
export default function ThankYou() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Thank you!</h1>
      <p className="mt-2 text-slate-600">We received your request. We’ll get back to you shortly.</p>
      <a className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-800" href="/">Back to home</a>
    </main>
  );
}
