// app/quote/page.tsx
//
// Server wrapper for the quote print page.
// - If no quote_no is present, show a friendly "no quote selected" state.
// - Otherwise, render the client component which does all the real work.

import QuotePrintClient from "./QuotePrintClient";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;
export const runtime = "nodejs";

type PageProps = {
  searchParams?: { [key: string]: string | string[] | undefined };
};

export default function Page({ searchParams }: PageProps) {
  const quoteNoParam = searchParams?.quote_no;
  const quoteNo = Array.isArray(quoteNoParam)
    ? quoteNoParam[0]
    : quoteNoParam;

  // If we don't have a quote_no in the URL, this is usually a sales/viewer
  // landing here after login. Show a gentle empty state instead of an error.
  if (!quoteNo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
        <div className="max-w-xl rounded-2xl bg-neutral-900 px-6 py-8 text-center text-neutral-50 shadow-lg">
          <h1 className="mb-3 text-lg font-semibold">No quote selected</h1>
          <p className="mb-2 text-sm text-neutral-300">
            This page is usually opened from a quote link in your email.
          </p>
          <p className="text-xs text-neutral-400">
            Ask your admin to send you a quote, or open a full quote URL that
            includes a quote number (for example,
            {" "}
            <code className="rounded bg-neutral-800 px-1 py-0.5 text-[11px]">
              /quote?quote_no=1234
            </code>
            ).
          </p>
        </div>
      </div>
    );
  }

  // Simple shell so Next can render /quote safely at build time.
  // The client component will read quote_no from the URL as before.
  return <QuotePrintClient />;
}
