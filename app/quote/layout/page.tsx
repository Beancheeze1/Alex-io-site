// app/quote/layout/page.tsx
import QuoteLayoutDiagram from "./QuoteLayoutDiagram";

type LayoutPageProps = {
  searchParams?: {
    quote_no?: string;
    dims?: string;
    qty?: string;
    cavityDims?: string;
  };
};

export default function QuoteLayoutPage(props: LayoutPageProps) {
  const sp = props.searchParams || {};
  const quoteNo = sp.quote_no || "";
  const dims = sp.dims || "";
  const qtyStr = sp.qty || "";
  const qty =
    qtyStr && !Number.isNaN(Number(qtyStr)) ? Number(qtyStr) : null;

  const cavityDims =
    sp.cavityDims && sp.cavityDims.length > 0
      ? sp.cavityDims.split("|")
      : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <header className="mb-4">
          <h1 className="text-lg font-semibold text-slate-900">
            Visual layout preview
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Auto-generated from your quote specs to help visualize the block
            and cavity arrangement.
          </p>
          {quoteNo && (
            <p className="mt-1 text-xs text-slate-500">
              Quote #: <span className="font-mono">{quoteNo}</span>
            </p>
          )}
        </header>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <QuoteLayoutDiagram
            dims={dims}
            qty={qty}
            cavityDims={cavityDims}
          />
        </section>

        <p className="mt-4 text-xs text-slate-500">
          This is a layout visualization only — final fit, clearances, and
          cushioning performance will be confirmed during engineering review
          before any production run.
        </p>
      </div>
    </main>
  );
}
